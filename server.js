require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

function getShop(shopId) {
  try {
    var shops = JSON.parse(fs.readFileSync('shop.json'));
    var shop = shops[shopId] || shops['SHOP_001'];
    shop.shopifyUrl = process.env[shopId + '_SHOPIFY_URL'] || process.env['SHOP_001_SHOPIFY_URL'] || '';
    shop.shopifyToken = process.env[shopId + '_SHOPIFY_TOKEN'] || process.env['SHOP_001_SHOPIFY_TOKEN'] || '';
    return shop;
  } catch(e) {
    return {
      name: 'Boutique',
      returnPolicy: '30 jours',
      shippingDays: '3 à 5',
      color: '#4F46E5',
      shopifyUrl: process.env['SHOP_001_SHOPIFY_URL'] || '',
      shopifyToken: process.env['SHOP_001_SHOPIFY_TOKEN'] || ''
    };
  }
}

async function getShopifyOrder(orderNumber, shopifyUrl, shopifyToken) {
  if (!shopifyUrl || !shopifyToken) return { found: false };
  try {
    var response = await fetch('https://' + shopifyUrl + '/admin/api/2024-01/orders.json?name=' + encodeURIComponent(orderNumber) + '&status=any', {
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json'
      }
    });
    var data = await response.json();
    if (!data.orders || data.orders.length === 0) return { found: false };

    var order = data.orders[0];

    // Statut global
    var statutGlobal = 'en attente';
    if (order.fulfillment_status === 'fulfilled') statutGlobal = 'entièrement livrée';
    if (order.fulfillment_status === 'partial') statutGlobal = 'partiellement livrée';
    if (order.fulfillment_status === null && order.financial_status === 'paid') statutGlobal = 'payée, en attente expédition';
    if (order.cancelled_at) statutGlobal = 'annulée';

    // Statut paiement
    var statutPaiement = order.financial_status;
    if (order.financial_status === 'paid') statutPaiement = 'payée';
    if (order.financial_status === 'partially_refunded') statutPaiement = 'partiellement remboursée';
    if (order.financial_status === 'refunded') statutPaiement = 'entièrement remboursée';
    if (order.financial_status === 'pending') statutPaiement = 'en attente de paiement';

    // Articles commandés avec leur statut individuel
    var articles = order.line_items.map(function(item) {
      var statut = 'en attente expédition';
      if (item.fulfillment_status === 'fulfilled') statut = 'livré';
      if (item.fulfillment_status === null && order.cancelled_at) statut = 'annulé';
      return item.name + ' (qté: ' + item.quantity + ', prix: ' + item.price + ' ' + order.currency + ', statut: ' + statut + ')';
    }).join(' | ');

    // Expéditions (peut y en avoir plusieurs = livraison en plusieurs fois)
    var expeditions = [];
    if (order.fulfillments && order.fulfillments.length > 0) {
      order.fulfillments.forEach(function(f, index) {
        var articlesExp = f.line_items.map(function(i){ return i.name + ' x' + i.quantity; }).join(', ');
        var dateExp = new Date(f.created_at).toLocaleDateString('fr-FR');
        var statutExp = f.status === 'success' ? 'livré' : f.status;
        expeditions.push(
          'Expédition ' + (index + 1) + ': ' + articlesExp +
          ', Date: ' + dateExp +
          ', Statut: ' + statutExp +
          (f.tracking_number ? ', Numéro suivi: ' + f.tracking_number : '') +
          (f.tracking_url ? ', Lien suivi: ' + f.tracking_url : '') +
          (f.tracking_company ? ', Transporteur: ' + f.tracking_company : '')
        );
      });
    }

    // Remboursements
    var remboursements = [];
    if (order.refunds && order.refunds.length > 0) {
      order.refunds.forEach(function(refund, index) {
        var montantRembourse = '0';
        if (refund.transactions && refund.transactions.length > 0) {
          montantRembourse = refund.transactions.reduce(function(sum, t){ return sum + parseFloat(t.amount); }, 0).toFixed(2);
        }
        var articlesRembourses = '';
        if (refund.refund_line_items && refund.refund_line_items.length > 0) {
          articlesRembourses = refund.refund_line_items.map(function(r){
            return r.line_item.name + ' x' + r.quantity;
          }).join(', ');
        }
        var dateRemboursement = new Date(refund.created_at).toLocaleDateString('fr-FR');
        remboursements.push(
          'Remboursement ' + (index + 1) + ': ' +
          (articlesRembourses ? 'Articles: ' + articlesRembourses + ', ' : '') +
          'Montant: ' + montantRembourse + ' ' + order.currency +
          ', Date: ' + dateRemboursement +
          (refund.note ? ', Raison: ' + refund.note : '')
        );
      });
    }

    // Annulation
    var annulation = '';
    if (order.cancelled_at) {
      annulation = 'Commande annulée le ' + new Date(order.cancelled_at).toLocaleDateString('fr-FR') +
        (order.cancel_reason ? ', Raison: ' + order.cancel_reason : '');
    }

    return {
      found: true,
      number: order.name,
      statutGlobal: statutGlobal,
      statutPaiement: statutPaiement,
      total: order.total_price + ' ' + order.currency,
      sousTotal: order.subtotal_price + ' ' + order.currency,
      totalRemboursé: order.total_refunds || '0',
      createdAt: new Date(order.created_at).toLocaleDateString('fr-FR'),
      articles: articles,
      expeditions: expeditions.length > 0 ? expeditions.join(' || ') : 'Aucune expédition encore',
      remboursements: remboursements.length > 0 ? remboursements.join(' || ') : '',
      annulation: annulation,
      noteCommande: order.note || ''
    };

  } catch(e) {
    console.error('Erreur Shopify:', e);
    return { found: false };
  }
}

function extractOrderNumber(message) {
  var match = message.match(/#?(\d{4,})/);
  return match ? '#' + match[1] : null;
}

async function askMistral(userMessage, shopConfig, orderInfo) {
  var orderContext = '';
  if (orderInfo && orderInfo.found) {
    orderContext = '\n\nINFORMATIONS COMPLÈTES DE LA COMMANDE:\n' +
      'Numéro: ' + orderInfo.number + '\n' +
      'Date de commande: ' + orderInfo.createdAt + '\n' +
      'Statut global: ' + orderInfo.statutGlobal + '\n' +
      'Statut paiement: ' + orderInfo.statutPaiement + '\n' +
      'Sous-total: ' + orderInfo.sousTotal + '\n' +
      'Total payé: ' + orderInfo.total + '\n' +
      'Articles commandés: ' + orderInfo.articles + '\n' +
      'Expéditions: ' + orderInfo.expeditions + '\n' +
      (orderInfo.remboursements ? 'Remboursements: ' + orderInfo.remboursements + '\n' : '') +
      (orderInfo.annulation ? 'Annulation: ' + orderInfo.annulation + '\n' : '') +
      (orderInfo.noteCommande ? 'Note: ' + orderInfo.noteCommande + '\n' : '') +
      '\nPrésente ces informations de manière claire, organisée et rassurante pour le client. Ne copie pas les données brutes mot pour mot, reformule de façon naturelle et humaine.';
  } else if (orderInfo && !orderInfo.found) {
    orderContext = '\nAucune commande trouvée avec ce numéro. Demande poliment le bon numéro de commande.';
  }

  var systemPrompt = "Tu es UNIQUEMENT l'assistant support de la boutique " + shopConfig.name + ". " +
    "Tu reponds SEULEMENT aux questions sur les commandes, livraisons, retours, produits et paiements. " +
    "Politique de retours : " + shopConfig.returnPolicy + ". " +
    "Delai de livraison : " + shopConfig.shippingDays + " jours ouvrés. " +
    orderContext +
    "\nSi le client pose une question sans rapport avec la boutique, reponds : Je suis uniquement disponible pour vous aider avec vos achats sur " + shopConfig.name + ". " +
    "Ne reponds JAMAIS a des questions hors boutique. " +
    "Reponds toujours en français de manière professionnelle, chaleureuse et rassurante. " +
    "N'utilise jamais de markdown comme ** ou ## dans tes réponses.";

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

app.post('/chat', async (req, res) => {
  var shopId = req.body.shopId || 'SHOP_001';
  var shopConfig = getShop(shopId);
  var message = req.body.message;

  try {
    var orderNumber = extractOrderNumber(message);
    var orderInfo = null;

    if (orderNumber && shopConfig.shopifyUrl && shopConfig.shopifyToken) {
      console.log('Recherche commande:', orderNumber, 'pour', shopConfig.name);
      orderInfo = await getShopifyOrder(orderNumber, shopConfig.shopifyUrl, shopConfig.shopifyToken);
    }

    var reply = await askMistral(message, shopConfig, orderInfo);
    res.json({ success: true, reply: reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, reply: 'Désolé, une erreur est survenue.' });
  }
});

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