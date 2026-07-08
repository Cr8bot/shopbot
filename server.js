require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const SHOPIFY_URL = process.env.SHOPIFY_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

// Charge la config d'une boutique depuis shop.json
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

// Cherche une commande sur Shopify par numéro
async function getShopifyOrder(orderNumber) {
  try {
    var response = await fetch('https://' + SHOPIFY_URL + '/admin/api/2024-01/orders.json?name=' + encodeURIComponent(orderNumber) + '&status=any', {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    var data = await response.json();
    if (data.orders && data.orders.length > 0) {
      var order = data.orders[0];
      return {
        found: true,
        number: order.name,
        status: order.fulfillment_status || 'en attente',
        total: order.total_price + ' ' + order.currency,
        createdAt: new Date(order.created_at).toLocaleDateString('fr-FR'),
        trackingUrl: order.fulfillments && order.fulfillments[0] ? order.fulfillments[0].tracking_url : null,
        trackingNumber: order.fulfillments && order.fulfillments[0] ? order.fulfillments[0].tracking_number : null
      };
    }
    return { found: false };
  } catch(e) {
    console.error('Erreur Shopify:', e);
    return { found: false };
  }
}

// Détecte si le message contient un numéro de commande
function extractOrderNumber(message) {
  var match = message.match(/#?(\d{4,})/);
  return match ? '#' + match[1] : null;
}

async function askMistral(userMessage, shopConfig, orderInfo) {
  var orderContext = '';
  if (orderInfo && orderInfo.found) {
    orderContext = '\nInformations commande trouvée : ' +
      'Numéro: ' + orderInfo.number +
      ', Statut: ' + orderInfo.status +
      ', Total: ' + orderInfo.total +
      ', Date: ' + orderInfo.createdAt +
      (orderInfo.trackingNumber ? ', Numéro de suivi: ' + orderInfo.trackingNumber : '') +
      (orderInfo.trackingUrl ? ', Lien de suivi: ' + orderInfo.trackingUrl : '');
  } else if (orderInfo && !orderInfo.found) {
    orderContext = '\nAucune commande trouvée avec ce numéro. Demande poliment le bon numéro de commande.';
  }

  var systemPrompt = "Tu es UNIQUEMENT l'assistant support de la boutique " + shopConfig.name + ". " +
    "Tu reponds SEULEMENT aux questions sur les commandes, livraisons, retours, produits et paiements. " +
    "Politique de retours : " + shopConfig.returnPolicy + ". " +
    "Delai de livraison : " + shopConfig.shippingDays + " jours ouvrés. " +
    orderContext +
    " Si le client pose une question sans rapport avec la boutique, reponds : " +
    "Je suis uniquement disponible pour vous aider avec vos achats sur " + shopConfig.name + ". " +
    "Ne reponds JAMAIS a des questions hors boutique. Reponds toujours en français.";

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

// Route chat principale
app.post('/chat', async (req, res) => {
  var shopId = req.body.shopId || 'SHOP_001';
  var shopConfig = getShop(shopId);
  var message = req.body.message;

  try {
    // Détecte si le client mentionne un numéro de commande
    var orderNumber = extractOrderNumber(message);
    var orderInfo = null;

    if (orderNumber) {
      console.log('Recherche commande Shopify:', orderNumber);
      orderInfo = await getShopifyOrder(orderNumber);
    }

    var reply = await askMistral(message, shopConfig, orderInfo);
    res.json({ success: true, reply: reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, reply: 'Désolé, une erreur est survenue.' });
  }
});

// Route config boutique
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