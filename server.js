require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.static('.'));

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

function getShop(shopId) {
  try {
    var shops = JSON.parse(fs.readFileSync('shop.json'));
    var shop = shops[shopId] || shops['SHOP_001'];
    shop.shopifyUrl = shopId !== 'SHOP_DEMO' ? (process.env[shopId + '_SHOPIFY_URL'] || process.env['SHOP_001_SHOPIFY_URL'] || '') : '';
    shop.shopifyToken = shopId !== 'SHOP_DEMO' ? (process.env[shopId + '_SHOPIFY_TOKEN'] || process.env['SHOP_001_SHOPIFY_TOKEN'] || '') : '';
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

// Récupère tous les produits avec stock et variantes
async function getShopifyProducts(shopifyUrl, shopifyToken) {
  if (!shopifyUrl || !shopifyToken) return [];
  try {
    var response = await fetch('https://' + shopifyUrl + '/admin/api/2024-01/products.json?limit=50&status=active', {
      headers: { 'X-Shopify-Access-Token': shopifyToken }
    });
    var data = await response.json();
    if (!data.products) return [];
    return data.products.map(function(p) {
      var variantes = p.variants.map(function(v) {
        var stockInfo = v.inventory_quantity > 0 ? 'en stock (' + v.inventory_quantity + ' dispo)' : 'rupture de stock';
        return v.title + ' - ' + v.price + ' EUR - ' + stockInfo;
      }).join(' | ');
      return {
        nom: p.title,
        description: p.body_html ? p.body_html.replace(/<[^>]*>/g, '').substring(0, 200) : '',
        variantes: variantes,
        tags: p.tags,
        type: p.product_type
      };
    });
  } catch(e) {
    console.error('Erreur produits Shopify:', e);
    return [];
  }
}

// Récupère une commande Shopify complète
async function getShopifyOrder(orderNumber, shopifyUrl, shopifyToken) {
  if (!shopifyUrl || !shopifyToken) return { found: false };
  try {
    var response = await fetch('https://' + shopifyUrl + '/admin/api/2024-01/orders.json?name=' + encodeURIComponent(orderNumber) + '&status=any', {
      headers: { 'X-Shopify-Access-Token': shopifyToken }
    });
    var data = await response.json();
    if (!data.orders || data.orders.length === 0) return { found: false };

    var order = data.orders[0];

    var statutGlobal = 'en attente';
    if (order.fulfillment_status === 'fulfilled') statutGlobal = 'entièrement livrée';
    if (order.fulfillment_status === 'partial') statutGlobal = 'partiellement livrée';
    if (order.fulfillment_status === null && order.financial_status === 'paid') statutGlobal = 'payée, en attente expédition';
    if (order.cancelled_at) statutGlobal = 'annulée';

    var statutPaiement = order.financial_status;
    if (order.financial_status === 'paid') statutPaiement = 'payée';
    if (order.financial_status === 'partially_refunded') statutPaiement = 'partiellement remboursée';
    if (order.financial_status === 'refunded') statutPaiement = 'entièrement remboursée';
    if (order.financial_status === 'pending') statutPaiement = 'en attente de paiement';

    var articles = order.line_items.map(function(item) {
      var statut = 'en attente expédition';
      if (item.fulfillment_status === 'fulfilled') statut = 'livré';
      if (item.fulfillment_status === null && order.cancelled_at) statut = 'annulé';
      return item.name + ' (qté: ' + item.quantity + ', prix: ' + item.price + ' EUR, statut: ' + statut + ')';
    }).join(' | ');

    var expeditions = [];
    if (order.fulfillments && order.fulfillments.length > 0) {
      order.fulfillments.forEach(function(f, index) {
        var articlesExp = f.line_items.map(function(i){ return i.name + ' x' + i.quantity; }).join(', ');
        expeditions.push(
          'Expédition ' + (index + 1) + ': ' + articlesExp +
          ', Date: ' + new Date(f.created_at).toLocaleDateString('fr-FR') +
          ', Statut: ' + (f.status === 'success' ? 'livré' : f.status) +
          (f.tracking_number ? ', N° suivi: ' + f.tracking_number : '') +
          (f.tracking_url ? ', Lien: ' + f.tracking_url : '') +
          (f.tracking_company ? ', Transporteur: ' + f.tracking_company : '')
        );
      });
    }

    var remboursements = [];
    if (order.refunds && order.refunds.length > 0) {
      order.refunds.forEach(function(refund, index) {
        var montant = '0';
        if (refund.transactions && refund.transactions.length > 0) {
          montant = refund.transactions.reduce(function(sum, t){ return sum + parseFloat(t.amount); }, 0).toFixed(2);
        }
        var articlesRem = '';
        if (refund.refund_line_items && refund.refund_line_items.length > 0) {
          articlesRem = refund.refund_line_items.map(function(r){ return r.line_item.name + ' x' + r.quantity; }).join(', ');
        }
        remboursements.push(
          'Remboursement ' + (index + 1) + ': ' +
          (articlesRem ? 'Articles: ' + articlesRem + ', ' : '') +
          'Montant: ' + montant + ' EUR, Date: ' + new Date(refund.created_at).toLocaleDateString('fr-FR') +
          (refund.note ? ', Raison: ' + refund.note : '')
        );
      });
    }

    return {
      found: true,
      number: order.name,
      statutGlobal: statutGlobal,
      statutPaiement: statutPaiement,
      total: order.total_price + ' EUR',
      sousTotal: order.subtotal_price + ' EUR',
      createdAt: new Date(order.created_at).toLocaleDateString('fr-FR'),
      articles: articles,
      expeditions: expeditions.length > 0 ? expeditions.join(' || ') : 'Aucune expédition encore',
      remboursements: remboursements.length > 0 ? remboursements.join(' || ') : '',
      annulation: order.cancelled_at ? 'Annulée le ' + new Date(order.cancelled_at).toLocaleDateString('fr-FR') + (order.cancel_reason ? ', Raison: ' + order.cancel_reason : '') : '',
      noteCommande: order.note || ''
    };
  } catch(e) {
    console.error('Erreur commande Shopify:', e);
    return { found: false };
  }
}

function extractOrderNumber(message) {
  var match = message.match(/#?(\d{4,})/);
  return match ? '#' + match[1] : null;
}

// Détecte si le message parle de produits
function mentionsProduit(message) {
  var keywords = ['produit', 'article', 'stock', 'disponible', 'taille', 'couleur', 'variante', 'prix', 'combien', 'collection', 'snowboard', 'ski', 'wax', 'carte', 'gift', 'acheter', 'commander', 'réappro', 'rupture'];
  var msg = message.toLowerCase();
  return keywords.some(function(k){ return msg.includes(k); });
}

async function askMistral(userMessage, shopConfig, orderInfo, produits) {
  var orderContext = '';
  if (orderInfo && orderInfo.found) {
    orderContext = '\n\nINFORMATIONS COMMANDE:\n' +
      'Numéro: ' + orderInfo.number + '\n' +
      'Date: ' + orderInfo.createdAt + '\n' +
      'Statut global: ' + orderInfo.statutGlobal + '\n' +
      'Statut paiement: ' + orderInfo.statutPaiement + '\n' +
      'Total: ' + orderInfo.total + '\n' +
      'Articles: ' + orderInfo.articles + '\n' +
      'Expéditions: ' + orderInfo.expeditions + '\n' +
      (orderInfo.remboursements ? 'Remboursements: ' + orderInfo.remboursements + '\n' : '') +
      (orderInfo.annulation ? 'Annulation: ' + orderInfo.annulation + '\n' : '') +
      'Présente ces infos de façon claire, naturelle et rassurante. Ne copie pas les données brutes.';
  } else if (orderInfo && !orderInfo.found) {
    orderContext = '\nAucune commande trouvée avec ce numéro. Demande poliment le bon numéro.';
  }

  var produitsContext = '';
  if (produits && produits.length > 0) {
    produitsContext = '\n\nCATALOGUE PRODUITS EN TEMPS RÉEL:\n' +
      produits.map(function(p) {
        return 'Produit: ' + p.nom +
          (p.description ? ', Description: ' + p.description : '') +
          ', Variantes/Stock/Prix: ' + p.variantes +
          (p.tags ? ', Tags: ' + p.tags : '');
      }).join('\n') +
      '\nUtilise ces infos pour répondre aux questions sur les produits, stocks et prix.';
  }

  // Construit le contexte FAQ
  var faqContext = '';
  if (shopConfig.faq) {
    var faq = shopConfig.faq;
    faqContext = '\n\nFAQ ET INFORMATIONS DE LA BOUTIQUE:\n';
    if (faq.livraison) faqContext += 'LIVRAISON: ' + JSON.stringify(faq.livraison) + '\n';
    if (faq.retours) faqContext += 'RETOURS: ' + JSON.stringify(faq.retours) + '\n';
    if (faq.paiement) faqContext += 'PAIEMENT: ' + JSON.stringify(faq.paiement) + '\n';
    if (faq.compte) faqContext += 'COMPTE CLIENT: ' + JSON.stringify(faq.compte) + '\n';
    if (faq.produits) faqContext += 'PRODUITS: ' + JSON.stringify(faq.produits) + '\n';
    if (faq.general) faqContext += 'GENERAL: ' + JSON.stringify(faq.general) + '\n';
    faqContext += 'Utilise ces informations pour répondre aux questions fréquentes des clients.';
  }

  var systemPrompt = "Tu es UNIQUEMENT l'assistant support de la boutique " + shopConfig.name + ". " +
    "Tu reponds SEULEMENT aux questions liées à la boutique : commandes, livraisons, retours, produits, stocks, prix, paiements, promotions, compte client. " +
    "Politique de retours : " + shopConfig.returnPolicy + ". " +
    "Delai de livraison : " + shopConfig.shippingDays + " jours ouvrés. " +
    orderContext +
    produitsContext +
    faqContext +
    "\nSi question hors boutique : réponds uniquement 'Je suis disponible uniquement pour vous aider avec vos achats sur " + shopConfig.name + "'. " +
    "Réponds toujours dans la même langue que le client. Si le client écrit en français réponds en français, si en anglais réponds en anglais, si en espagnol réponds en espagnol, etc. " +
    "Sois professionnel, chaleureux et concis. " +
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
    var produits = null;

    // Cherche commande si numéro détecté
    if (orderNumber && shopConfig.shopifyUrl && shopConfig.shopifyToken) {
      console.log('Recherche commande:', orderNumber);
      orderInfo = await getShopifyOrder(orderNumber, shopConfig.shopifyUrl, shopConfig.shopifyToken);
    }

    // Charge les produits si question sur produits/stock
    if (mentionsProduit(message) && shopConfig.shopifyUrl && shopConfig.shopifyToken) {
      console.log('Chargement catalogue produits...');
      produits = await getShopifyProducts(shopConfig.shopifyUrl, shopConfig.shopifyToken);
    }

    var reply = await askMistral(message, shopConfig, orderInfo, produits);
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