/**
 * Where Support & feedback sends people. Only a press ever opens these, and a block
 * stays hidden while its link is empty, so the app ships whole with either one missing.
 *
 * `.invalid` never resolves (RFC 6761), so a stand-in can send nobody to a stranger's
 * page, and a release refuses one (tests/test_whats_new.py).
 */
export const KOFI_URL = 'https://ko-fi.invalid/azimut';
export const FEEDBACK_FORM_URL = '';
