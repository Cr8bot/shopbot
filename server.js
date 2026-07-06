require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

async function askMistral(userMessage, shopConfig) {
  const systemPrompt = "Tu es UNIQUEMENT l'assistant support de la boutique " + shopConfig.name + ". "
    + "Tu reponds SEULEMENT aux questions sur les commandes, livraisons, retours, produits et paiements. "
    + "Politique de retours : " + shopConfig.returnPolicy + ". "
    + "Delai de livraison : " + shopConfig.shippingDays + " jours ouvrés. "
    + "Si le client pose une question sans rapport avec la boutique, reponds : "
    + "Je suis uniquement disponible pour vous aider avec vos achats sur " + shopConfig.name + ". "
    + "Ne reponds JAMAIS a des questions hors boutique.";

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MISTRAL_API_KEY
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

app.post('/chat', async (req, res) => {
  const shopConfig = {
    name: 'Ma Boutique Test',
    returnPolicy: '30 jours apres reception, article non utilise',
    shippingDays: '3 a 5'
  };
  try {
    const reply = await askMistral(req.body.message, shopConfig);
    res.json({ success: true, reply: reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, reply: 'Erreur serveur.' });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ShopBot est en ligne !' });
});

app.listen(3000, function() {
  console.log('ShopBot tourne sur http://localhost:3000');
});