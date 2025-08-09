// Minimal smoke tests (run with your preferred runner)
const TextProcessor = require('../text-processor.js');

describe('TextProcessor', () => {
  it('cleans and deduplicates', () => {
    const tp = new TextProcessor();
    const input = 'Hello world!\nHello   world!\nContact: test@example.com';
    const out = tp.processForLLM(input, { removeDuplicates: true, removeEmails: true });
    expect(out.processedText.toLowerCase()).toContain('hello world');
    expect(out.processedText).not.toContain('test@example.com');
  });
});

