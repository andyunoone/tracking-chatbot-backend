const { onRequest } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI, TaskType } = require("@google/generative-ai");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Inizializza Firebase Admin per accesso a Firestore
initializeApp();
const db = getFirestore();

// Rate limiting: massimo 200 richieste al giorno
const DAILY_LIMIT = 200;
let requestCount = 0;
let currentDate = new Date().toDateString();

function checkRateLimit() {
    const today = new Date().toDateString();
    if (today !== currentDate) {
        currentDate = today;
        requestCount = 0;
    }
    requestCount++;
    return requestCount <= DAILY_LIMIT;
}

// --- ISTRUZIONI STATICHE (senza dati, solo regole di comportamento) ---

const INSTRUCTIONS_IT = `Sei un assistente turistico virtuale per l'Isola di San Pietro (Carloforte), in Sardegna, Italia.
Il tuo compito è aiutare i turisti con informazioni su:
- Spiagge, percorsi trekking e geositi dell'isola
- Ristoranti, bar, gelaterie, alloggi (hotel, B&B, case vacanza)
- Trasporti (traghetti, bus, taxi, noleggio)
- Eventi e tradizioni locali (tutto l'anno)
- Piatti tipici e cucina tabarchina
- Storia dettagliata dell'isola e dei tabarchini
- Siti storici e monumenti (chiese, forte, museo, tonnara)
- Attività ed esperienze (barca, kayak, diving, snorkeling, pescaturismo, birdwatching, e-bike)
- Vita serale e aperitivi
- Shopping e souvenir (bottarga, tonno, artigianato)
- Temperature del mare e spot di snorkeling
- Punti panoramici e fotografia
- Gite giornaliere (Sant'Antioco, Calasetta, Buggerru, Sulcis-Iglesiente)
- Accessibilità per disabili
- Contatti utili e numeri di emergenza
- Curiosità sull'isola e sulla cultura tabarchina

IMPORTANTE: Usa SEMPRE i dati forniti qui sotto per rispondere. Contengono informazioni dettagliate e specifiche. Non inventare dati che non sono presenti. Se le informazioni richieste non sono nei dati forniti, dillo chiaramente.
Rispondi in modo breve e diretto, massimo 3-4 frasi per risposta. Vai al punto senza introduzioni o ripetizioni. Usa grassetto (**testo**) per evidenziare nomi e informazioni importanti. Usa elenchi puntati solo se ci sono più elementi da elencare.
Rispondi in italiano.`;

const INSTRUCTIONS_EN = `You are a virtual tourist assistant for the Island of San Pietro (Carloforte), in Sardinia, Italy.
Your task is to help tourists with information about:
- Beaches, trekking routes and geosites of the island
- Restaurants, bars, gelaterias, accommodations (hotels, B&Bs, vacation rentals)
- Transportation (ferries, buses, taxis, rentals)
- Events and local traditions (year-round)
- Typical dishes and Tabarchino cuisine
- Detailed island history and the Tabarchini people
- Historical sites and monuments (churches, fort, museum, tonnara)
- Activities and experiences (boat tours, kayak, diving, snorkeling, fishing tourism, birdwatching, e-bike)
- Nightlife and aperitivo spots
- Shopping and souvenirs (bottarga, tuna products, crafts)
- Sea water temperatures and snorkeling spots
- Scenic viewpoints and photography
- Day trips (Sant'Antioco, Calasetta, Buggerru, Sulcis-Iglesiente)
- Accessibility for disabled visitors
- Useful contacts and emergency numbers
- Curiosities about the island and Tabarchino culture

IMPORTANT: ALWAYS use the data provided below to answer. It contains detailed and specific information. Do not make up data that is not present. If the requested information is not in the provided data, say so clearly.
Keep your answers short and direct, maximum 3-4 sentences per response. Get to the point without introductions or repetitions. Use bold (**text**) to highlight names and key information. Use bullet points only when listing multiple items.
Respond in English.`;

// --- FUNZIONI RAG ---

async function embedQuery(genAI, text) {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent({
        content: { parts: [{ text }] },
        taskType: TaskType.RETRIEVAL_QUERY,
        outputDimensionality: 768
    });
    return result.embedding.values;
}

async function retrieveRelevantSections(queryEmbedding, limit = 5) {
    const collectionRef = db.collection("knowledgeSections");
    const vectorQuery = collectionRef.findNearest({
        vectorField: "embedding",
        queryVector: FieldValue.vector(queryEmbedding),
        limit: limit,
        distanceMeasure: "COSINE"
    });

    const snapshot = await vectorQuery.get();
    const sections = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        sections.push({
            title: data.title,
            content: data.content
        });
    });
    return sections;
}

function buildSystemPrompt(language, sections) {
    const instructions = language === "en" ? INSTRUCTIONS_EN : INSTRUCTIONS_IT;
    const dataHeader = language === "en"
        ? "Here is the relevant tourist data for this question:"
        : "Ecco i dati turistici rilevanti per questa domanda:";

    const dataBlock = sections
        .map(s => `### ${s.title}\n${s.content}`)
        .join("\n\n");

    return `${instructions}\n\n${dataHeader}\n\n${dataBlock}`;
}

// --- HANDLER PRINCIPALE ---

exports.chat = onRequest(
    { cors: true, timeoutSeconds: 60, region: "europe-west1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }

        // Controlla il rate limit giornaliero
        if (!checkRateLimit()) {
            const isEnglish = req.body.language === "en";
            return res.json({
                response: isEnglish
                    ? "I'm sorry, I can't answer right now. Come back tomorrow, I'll be happy to help you! 😊"
                    : "Mi dispiace, al momento non posso rispondere. Torna a trovarmi domani, sarò felice di aiutarti! 😊"
            });
        }

        try {
            const { message, language, history } = req.body;

            if (!message) {
                return res.status(400).json({ error: "Message is required" });
            }

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

            // RAG: embedding della domanda e recupero sezioni rilevanti
            const queryEmbedding = await embedQuery(genAI, message);
            const relevantSections = await retrieveRelevantSections(queryEmbedding);

            // Costruisci il system prompt dinamico con solo le sezioni rilevanti
            const systemPrompt = buildSystemPrompt(language, relevantSections);

            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                systemInstruction: systemPrompt
            });

            // Costruisci la cronologia per il contesto della conversazione
            // Gemini richiede che la cronologia inizi con un messaggio "user"
            const chatHistory = [];
            if (history && Array.isArray(history)) {
                let foundFirstUser = false;
                for (const msg of history) {
                    if (!foundFirstUser && !msg.isUser) continue;
                    foundFirstUser = true;
                    chatHistory.push({
                        role: msg.isUser ? "user" : "model",
                        parts: [{ text: msg.text }]
                    });
                }
            }

            const chat = model.startChat({ history: chatHistory });
            const result = await chat.sendMessage(message);
            const response = result.response.text();

            res.json({ response });
        } catch (error) {
            console.error("Error:", error.message);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);
