import * as fs from 'fs';
import * as path from 'path';

const html = fs.readFileSync(path.join(__dirname, 'media', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, 'media', 'index.js'), 'utf8');

describe('webview customization contract', () => {
  it('renders all sources through one shared subscription surface', () => {
    expect(html).toContain('id="subscriptions"');
    expect(html).not.toContain('id="account-card"');
    expect(html).not.toContain('id="content"');
    expect(script).toContain('subscriptions.appendChild(renderSubscription(subscription, state.isLoading))');
    expect(script).toContain('for (const content of subscription.contents)');
    expect(script).toContain("metadataField('Account', subscription.account || '—')");
    expect(script).toContain("metadataField('Description', subscription.description || '—')");
  });

  it('wires names and visibility for subscriptions and content rows', () => {
    for (const messageType of [
      'renameSubscription',
      'renameContent',
      'setSubscriptionHidden',
      'setContentHidden'
    ]) {
      expect(script).toContain(`type: '${messageType}'`);
    }
    expect(script).toContain("nameInput.className = 'subscription-name-input'");
    expect(script).toContain("nameInput.className = 'content-name-input'");
  });

  it('wires independent drag ordering for subscriptions and their contents', () => {
    expect(script).toContain('enableSubscriptionReordering();');
    expect(script).toContain('enableContentReordering(list, subscription.key);');
    expect(script).toContain("handleSelector: '.subscription-drag-handle'");
    expect(script).toContain("handleSelector: '.content-drag-handle'");
    expect(script).toContain("type: 'setSubscriptionOrder'");
    expect(script).toContain("type: 'setContentOrder'");
  });
});
