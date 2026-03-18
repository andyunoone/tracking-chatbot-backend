require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const knowledgeBase = require('./knowledge-base.json');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT_IT = `Sei un assistente turistico virtuale per l'Isola di San Pietro (Carloforte), in Sardegna, Italia.
Il tuo compito è aiutare i turisti con informazioni su:
- Spiagge, percorsi trekking e geositi dell'isola
- Ristoranti, alloggi (hotel, B&B, case vacanza)
- Trasporti (traghetti, bus, taxi, noleggio)
- Eventi e tradizioni locali
- Informazioni utili (farmacia, carabinieri, numeri utili)
- Curiosità sull'isola e sulla cultura tabarchina

Rispondi sempre in modo cordiale, conciso e utile. Se non conosci una risposta specifica, suggerisci dove l'utente potrebbe trovare l'informazione.
Rispondi in italiano.

Ecco i dati turistici a tua disposizione:
${JSON.stringify(knowledgeBase, null, 2)}`;

const SYSTEM_PROMPT_EN = `You are a virtual tourist assistant for the Island of San Pietro (Carloforte), in Sardinia, Italy.
Your task is to help tourists with information about:
- Beaches, trekking routes and geosites of the island
- Restaurants, accommodations (hotels, B&Bs, vacation rentals)
- Transportation (ferries, buses, taxis, rentals)
- Events and local traditions
- Useful information (pharmacy, police, useful numbers)
- Curiosities about the island and Tabarchino culture

Always respond in a friendly, concise and helpful way. If you don't know a specific answer, suggest where the user might find the information.
Respond in English.

Here is the tourist data available to you:
${JSON.stringify(knowledgeBase, null, 2)}`;

app.post('/chat', async (req, res) => {
    try {
        const { message, language } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const systemPrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_IT;

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: systemPrompt
        });

        const result = await model.generateContent(message);
        const response = result.response.text();

        res.json({ response });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Tracking Chatbot Backend' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
