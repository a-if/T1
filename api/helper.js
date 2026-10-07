
export function getRandomPositiveReaction(reaction) {
    const randomIndex = Math.floor(Math.random() * reaction.length);
    return reaction[randomIndex];
}

export function splitEmojis(emojiString) {
    if (!emojiString) return [];
    const input = String(emojiString).trim();
    try {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return [...segmenter.segment(input)]
            .map(x => x.segment)
            .filter(x => /\p{Emoji}/u.test(x));
    } catch (_) {
        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji_Modifier_Base})(?:\uFE0F|\u200D(?!$)[\p{Emoji_Presentation}\p{Extended_Pictographic}])*/gu;
        return input.match(emojiRegex) || [];
    }
}

export function getChatIds(chats) {
    return chats ? chats.split(',').map(Number).filter(Boolean) : [];
}

export function returnHTML(content) {
    return new Response(content, {
        headers: { 'content-type': 'text/html' },
    });
}

export function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function chatKind(type) {
    if (type === 'private') return 'users';
    if (type === 'channel') return 'channels';
    if (type === 'group' || type === 'supergroup') return 'groups';
    return null;
}

export function webhookRootUrl(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    try { return new URL(s).origin + '/'; }
    catch { return s.replace(/\/$/, '') + '/'; }
}
