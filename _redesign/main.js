const b=document.querySelector('.burger'),n=document.getElementById('nav');
b.onclick=()=>{const o=n.classList.toggle('open');b.setAttribute('aria-expanded',o)};
n.querySelectorAll('a').forEach(a=>a.onclick=()=>n.classList.remove('open'));
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('posts').innerHTML=(window.POSTS||[]).map(p=>`<a class="post" href="${p.url}" target="_blank" rel="noopener"><div class="post-top"><span class="tag">${esc(p.tag)}</span><time>${esc(p.date)}</time></div><p>${esc(p.text)}</p><span class="go">View on X →</span></a>`).join('');
