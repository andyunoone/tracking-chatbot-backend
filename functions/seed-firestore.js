/**
 * Script one-time per popolare Firestore con le sezioni della knowledge base
 * e i relativi embedding vettoriali per la ricerca RAG.
 *
 * Uso: GEMINI_API_KEY=xxx node seed-firestore.js
 */

const admin = require("firebase-admin");
const { GoogleGenerativeAI, TaskType } = require("@google/generative-ai");
const { FieldValue } = require("firebase-admin/firestore");
const knowledgeBase = require("./knowledge-base.json");

// Inizializza Firebase Admin con service account
const serviceAccount = require("../service-account-key.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Inizializza Gemini per gli embedding
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// Titoli leggibili per ogni sezione
const TITLES = {
    isola: "Informazioni generali sull'Isola di San Pietro",
    storia_dettagliata: "Storia dettagliata dell'isola e dei tabarchini",
    siti_storici: "Siti storici e monumenti",
    trasporti: "Trasporti: traghetti, bus, taxi, noleggio",
    ristoranti: "Ristoranti, bar, gelaterie",
    piatti_tipici: "Piatti tipici e cucina tabarchina",
    alloggi: "Alloggi: hotel, B&B, case vacanza",
    spiagge: "Spiagge dell'isola",
    percorsi_trekking: "Percorsi trekking e sentieri",
    geositi: "Geositi e formazioni geologiche",
    natura: "Natura, fauna e flora",
    attivita_esperienze: "Attività ed esperienze: barca, kayak, diving, snorkeling, e-bike",
    vita_serale: "Vita serale e aperitivi",
    shopping_souvenir: "Shopping e souvenir: bottarga, tonno, artigianato",
    info_mare: "Informazioni sul mare, temperature e snorkeling",
    punti_panoramici: "Punti panoramici e fotografia",
    gite_giornaliere: "Gite giornaliere: Sant'Antioco, Calasetta, Buggerru",
    eventi: "Eventi e tradizioni locali",
    info_utili: "Informazioni utili per i visitatori",
    contatti_utili: "Contatti utili e numeri di emergenza",
    accessibilita: "Accessibilità per disabili",
    curiosita: "Curiosità sull'isola e cultura tabarchina",
    consigli_pratici: "Consigli pratici per i turisti"
};

async function seed() {
    const sections = Object.entries(knowledgeBase);
    console.log(`Seeding ${sections.length} sezioni su Firestore...\n`);

    for (const [key, value] of sections) {
        const content = JSON.stringify(value, null, 2);
        const title = TITLES[key] || key;

        // Embedding: titolo + contenuto per miglior contesto semantico
        const textToEmbed = `${title}: ${content}`;
        const result = await embeddingModel.embedContent({
            content: { parts: [{ text: textToEmbed }] },
            taskType: TaskType.RETRIEVAL_DOCUMENT,
            title: title,
            outputDimensionality: 768
        });
        const embeddingValues = result.embedding.values;

        // Salva su Firestore
        await db.collection("knowledgeSections").doc(key).set({
            sectionKey: key,
            title: title,
            content: content,
            embedding: FieldValue.vector(embeddingValues),
            charCount: content.length,
            createdAt: FieldValue.serverTimestamp()
        });

        console.log(`  ✓ ${key} (${content.length} chars, ${embeddingValues.length}d vector)`);
    }

    console.log(`\nDone! ${sections.length} sezioni caricate su Firestore.`);
    console.log("\nProssimo step: creare l'indice vettoriale con:");
    console.log(`gcloud firestore indexes composite create \\
  --project=trekking-chatbot \\
  --collection-group=knowledgeSections \\
  --query-scope=COLLECTION \\
  --field-config=vector-config='{"dimension":"768","flat":{}}',field-path=embedding`);

    process.exit(0);
}

seed().catch(err => {
    console.error("Errore durante il seed:", err);
    process.exit(1);
});
