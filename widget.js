(function() {
  var SHOPBOT_URL = 'https://shopbot-production-8e84.up.railway.app';

  // Style du widget
  var style = document.createElement('style');
  style.innerHTML = `
    #shopbot-btn {
      position: fixed; bottom: 24px; right: 24px;
      width: 60px; height: 60px; border-radius: 50%;
      background: #4F46E5; border: none; cursor: pointer;
      font-size: 26px; box-shadow: 0 4px 20px rgba(79,70,229,0.4);
      z-index: 99999; transition: transform 0.2s;
    }
    #shopbot-btn:hover { transform: scale(1.1); }
    #shopbot-window {
      position: fixed; bottom: 96px; right: 24px;
      width: 360px; height: 500px; background: white;
      border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      z-index: 99999; display: none; flex-direction: column; overflow: hidden;
      font-family: Arial, sans-serif;
    }
    #shopbot-window.ouvert { display: flex; }
    #shopbot-header {
      background: #4F46E5; color: white;
      padding: 16px 20px; display: flex; align-items: center; gap: 12px;
    }
    .sb-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .sb-info p { margin: 0; font-weight: 600; font-size: 15px; }
    .sb-info small { opacity: 0.8; font-size: 12px; }
    #shopbot-close { margin-left: auto; background: none; border: none; color: white; font-size: 20px; cursor: pointer; }
    #shopbot-msgs {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .sb-bot, .sb-user {
      max-width: 80%; padding: 10px 14px;
      border-radius: 16px; font-size: 13px; line-height: 1.5;
    }
    .sb-bot { background: #f0f0f0; color: #333; align-self: flex-start; border-bottom-left-radius: 4px; }
    .sb-user { background: #4F46E5; color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
    .sb-typing { display: flex; gap: 4px; padding: 10px 14px; background: #f0f0f0; border-radius: 16px; border-bottom-left-radius: 4px; width: fit-content; }
    .sb-typing span { width: 6px; height: 6px; background: #999; border-radius: 50%; animation: sb-bounce 0.8s infinite; }
    .sb-typing span:nth-child(2) { animation-delay: 0.2s; }
    .sb-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes sb-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
    #shopbot-sugg { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid #eee; }
    .sb-sug { padding: 5px 12px; border: 1px solid #ddd; border-radius: 20px; font-size: 12px; cursor: pointer; background: white; color: #333; }
    .sb-sug:hover { background: #f5f5f5; }
    #shopbot-input-row { padding: 12px; border-top: 1px solid #eee; display: flex; gap: 8px; }
    #shopbot-input { flex: 1; padding: 8px 14px; border: 1px solid #ddd; border-radius: 20px; font-size: 13px; outline: none; }
    #shopbot-input:focus { border-color: #4F46E5; }
    #shopbot-send { width: 38px; height: 38px; background: #4F46E5; border: none; border-radius: 50%; color: white; font-size: 18px; cursor: pointer; }
    #shopbot-powered { text-align: center; padding: 6px; font-size: 11px; color: #aaa; }
  `;
  document.head.appendChild(style);

  // Bouton flottant
  var btn = document.createElement('button');
  btn.id = 'shopbot-btn';
  btn.innerHTML = '💬';
  document.body.appendChild(btn);

  // Fenêtre chat
  var win = document.createElement('div');
  win.id = 'shopbot-window';
  win.innerHTML = `
    <div id="shopbot-header">
      <div class="sb-avatar">🤖</div>
      <div class="sb-info">
        <p>Assistant Support</p>
        <small>● En ligne · Répond instantanément</small>
      </div>
      <button id="shopbot-close">✕</button>
    </div>
    <div id="shopbot-msgs">
      <div class="sb-bot">Bonjour ! Je suis votre assistant 24h/24. Comment puis-je vous aider ? 😊</div>
    </div>
    <div id="shopbot-sugg">
      <button class="sb-sug" onclick="shopbotSuggest('Où est ma commande ?')">📦 Ma commande</button>
      <button class="sb-sug" onclick="shopbotSuggest('Comment retourner un article ?')">↩️ Retours</button>
      <button class="sb-sug" onclick="shopbotSuggest('Délai de livraison ?')">🚚 Livraison</button>
    </div>
    <div id="shopbot-input-row">
      <input id="shopbot-input" type="text" placeholder="Écrivez votre message...">
      <button id="shopbot-send">➤</button>
    </div>
    <div id="shopbot-powered">Propulsé par ShopBot AI ✨</div>
  `;
  document.body.appendChild(win);

  // Ouvrir / fermer
  btn.onclick = function() { win.classList.toggle('ouvert'); };
  document.getElementById('shopbot-close').onclick = function() { win.classList.remove('ouvert'); };

  // Envoyer message
  window.shopbotSuggest = function(texte) {
    document.getElementById('shopbot-input').value = texte;
    shopbotEnvoyer();
  };

  document.getElementById('shopbot-send').onclick = shopbotEnvoyer;
  document.getElementById('shopbot-input').onkeydown = function(e) {
    if (e.key === 'Enter') shopbotEnvoyer();
  };

  async function shopbotEnvoyer() {
    var input = document.getElementById('shopbot-input');
    var msgs = document.getElementById('shopbot-msgs');
    var texte = input.value.trim();
    if (!texte) return;
    input.value = '';

    var um = document.createElement('div');
    um.className = 'sb-user';
    um.innerText = texte;
    msgs.appendChild(um);
    msgs.scrollTop = msgs.scrollHeight;

    var typing = document.createElement('div');
    typing.className = 'sb-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      var res = await fetch(SHOPBOT_URL + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texte })
      });
      var data = await res.json();
      typing.remove();
      var bm = document.createElement('div');
      bm.className = 'sb-bot';
      bm.innerText = data.reply;
      msgs.appendChild(bm);
      msgs.scrollTop = msgs.scrollHeight;
    } catch(e) {
      typing.remove();
      var bm2 = document.createElement('div');
      bm2.className = 'sb-bot';
      bm2.innerText = 'Désolé, une erreur est survenue.';
      msgs.appendChild(bm2);
    }
  }
})();