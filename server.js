require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// Charge la config d'une boutique depuis shops.json
function getShop(shopId) {
  try {
    var shops = JSON.parse(fs.readFileSync('shop.json'));
    return shops[shopId] || shops['SHOP_001'];
  } catch(e) {
    return {
      name: 'Boutique',
      returnPolicy: '30 jours',
      shippingDays: '3 à 5',
      color: '#4F46E5'
    };
  }
}

async function askMistral(userMessage, shopConfig) {
  var systemPrompt = "Tu es UNIQUEMENT l'assistant support de la boutique " + shopConfig.name + ". "
    + "Tu reponds SEULEMENT aux questions sur les commandes, livraisons, retours, produits et paiements. "
    + "Politique de retours : " + shopConfig.returnPolicy + ". "
    + "Delai de livraison : " + shopConfig.shippingDays + " jours ouvrés. "
    + "Si le client pose une question sans rapport avec la boutique, reponds : "
    + "Je suis uniquement disponible pour vous aider avec vos achats sur " + shopConfig.name + ". "
    + "Ne reponds JAMAIS a des questions hors boutique.";

  var response = await fetch('https://api.mistral.ai/v1/chat/completions', {
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

  var data = await response.json();
  return data.choices[0].message.content;
}

// Route chat — accepte un shopId
app.post('/chat', async (req, res) => {
  var shopId = req.body.shopId || 'SHOP_001';
  var shopConfig = getShop(shopId);
  try {
    var reply = await askMistral(req.body.message, shopConfig);
    res.json({ success: true, reply: reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, reply: 'Erreur serveur.' });
  }
});

// Route config — retourne la config publique d'une boutique
app.get('/config/:shopId', (req, res) => {
  var shop = getShop(req.params.shopId);
  res.json({ name: shop.name, color: shop.color });
});

app.get('/', (req, res) => {
  res.json({ status: 'ShopBot est en ligne !' });
});

app.listen(3000, function() {
  console.log('ShopBot tourne sur http://localhost:3000');
});