export interface ChatPanelCallbacks {
  onSendMessage?: (text: string) => void;
}

export function createChatPanel(
  messagesEl: HTMLElement,
  inputEl: HTMLInputElement,
  callbacks: ChatPanelCallbacks = {},
) {
  function appendMessage(author: string, text: string): void {
    const line = document.createElement('div');
    line.className = 'sc-chat-line';
    line.innerHTML = `<span class="sc-chat-author">${author}</span><span class="sc-chat-text">${escapeHtml(text)}</span>`;
    messagesEl.appendChild(line);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function sendMessage(): void {
    const text = inputEl.value.trim();
    if (!text) return;
    if (callbacks.onSendMessage) {
      callbacks.onSendMessage(text);
    } else {
      appendMessage('You', text);
    }
    inputEl.value = '';
  }

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
    event.stopPropagation();
  });

  inputEl.addEventListener('keyup', (event) => event.stopPropagation());
  inputEl.addEventListener('keypress', (event) => event.stopPropagation());

  appendMessage('SYS', 'Comms channel ready.');

  return { appendMessage, sendMessage };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
