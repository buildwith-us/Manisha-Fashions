import { readFileSync } from 'fs';
import path from 'path';

/**
 * The state list exists twice — the API normalises and prices by it, and the
 * app's address form offers it — because Metro cannot bundle a file from the
 * backend package. A drift between them would let the form offer a spelling
 * the COD rules do not key on, which is the bug the list exists to prevent.
 */
describe('indianStates.ts', () => {
  it('is identical in the backend and the mobile app', () => {
    const backendCopy = path.resolve(__dirname, '../constants/indianStates.ts');
    const mobileCopy = path.resolve(__dirname, '../../../mobile/src/constants/indianStates.ts');

    expect(readFileSync(mobileCopy, 'utf8')).toBe(readFileSync(backendCopy, 'utf8'));
  });
});
