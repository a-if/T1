
const MAP = {
  A:'ᴀ',B:'ʙ',C:'ᴄ',D:'ᴅ',E:'ᴇ',F:'ғ',G:'ɢ',H:'ʜ',I:'ɪ',J:'ᴊ',K:'ᴋ',L:'ʟ',M:'ᴍ',
  N:'ɴ',O:'ᴏ',P:'ᴘ',Q:'ǫ',R:'ʀ',S:'s',T:'ᴛ',U:'ᴜ',V:'ᴠ',W:'ᴡ',X:'x',Y:'ʏ',Z:'ᴢ',
  a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
  n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'
};

export function uiText(text) {
  const raw = String(text ?? '');
  const parts = raw.split(/(<[^>]*>|&(?:[a-zA-Z]+|#\d+);|https?:\/\/\S+|@[A-Za-z0-9_]+|\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?)/g);
  return parts.map(part => {
    if (!part) return part;
    if (/^<[^>]*>$/.test(part) || /^https?:\/\//i.test(part) || /^[@\/]/.test(part) || /^&(?:[a-zA-Z]+|#\d+);$/.test(part)) return part;
    return [...part].map(ch => MAP[ch] || ch).join('');
  }).join('');
}

export function uiButton(text, style = undefined) {
  const button = { text: uiText(text) };
  if (style) button.style = style;
  return button;
}
