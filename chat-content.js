(() => {
  const safeUrl = value => {
    try {
      const url = new URL(/^www\./i.test(value) ? 'https://' + value : value);
      return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const clipboardText = clipboard => {
    const plain = clipboard.getData('text/plain');
    if (plain) return plain.replace(/\r\n?/g, '\n');
    const uri = clipboard.getData('text/uri-list').split(/\r?\n/).filter(line => line && !line.startsWith('#')).join('\n');
    if (uri) return uri;
    const html = clipboard.getData('text/html');
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|TEMPLATE|HEAD|NOSCRIPT)$/.test(node.tagName)) return '';
      if (node.tagName === 'BR') return '\n';
      if (node.tagName === 'TR') return [...node.children].map(text).join('\t') + '\n';
      const value = [...node.childNodes].map(text).join('');
      if (node.tagName === 'A') {
        const href = safeUrl(node.getAttribute('href') || '');
        return href && !value.includes(href) ? (value ? value + ' (' + href + ')' : href) : value;
      }
      return value + (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(node.tagName) ? '\n' : '');
    };
    return text(doc.body).replace(/\n+$/, '');
  };
  const insertText = (input, value) => {
    if (!value || input.contentEditable === 'false') return;
    input.focus();
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !input.contains(range.startContainer) || !input.contains(range.endContainer)) {
      range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
    }
    selection.removeAllRanges(); selection.addRange(range);
    // Keep native undo when supported, with a Range fallback for other runtimes.
    if (!document.execCommand('insertText', false, value)) {
      range.deleteContents(); const node = document.createTextNode(value); range.insertNode(node);
      range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const linkify = container => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('a,small,button,.reply-quote,.message-file-size') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"\u0000-\u001f]+/gi;
      const fragment = document.createDocumentFragment(); let offset = 0, matched = false;
      for (const match of node.textContent.matchAll(pattern)) {
        let label = match[0].replace(/[.,;:!?]+$/, '');
        while (label.endsWith(')') && (label.match(/\)/g) || []).length > (label.match(/\(/g) || []).length) label = label.slice(0, -1);
        const href = safeUrl(label); if (!href) continue;
        fragment.append(document.createTextNode(node.textContent.slice(offset, match.index)));
        const link = document.createElement('a'); link.className = 'chat-message-link'; link.textContent = label;
        link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; fragment.append(link);
        offset = match.index + label.length; matched = true;
      }
      if (matched) { fragment.append(document.createTextNode(node.textContent.slice(offset))); node.replaceWith(fragment); }
    }
  };
  window.conectaChatContent = { clipboardText, insertText, linkify };
})();
