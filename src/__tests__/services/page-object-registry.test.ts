/**
 * Unit tests for lib/automation/page-object-registry.ts — URL-pattern normalization
 * and the match priority (URL pattern first, normalized label as fallback) used to
 * recognize "this is the same page as an earlier generation" (Automation Agent
 * Rebuild §4.1.1).
 */
import { describe, it, expect } from 'vitest';
import { matchRegistryEntry, normalizePageUrlPattern } from '@/services/automation/page-object-registry';
import type { RegistryEntry } from '@/models/validators/playwright';

describe('normalizePageUrlPattern', () => {
  it('strips query string and hash', () => {
    expect(normalizePageUrlPattern('https://example.com/settings?tab=billing#top')).toBe('/settings');
  });

  it('replaces a UUID path segment with :id', () => {
    expect(normalizePageUrlPattern('https://example.com/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/settings')).toBe(
      '/projects/:id/settings',
    );
  });

  it('replaces a long numeric path segment with :id but leaves short numbers alone', () => {
    expect(normalizePageUrlPattern('https://example.com/orders/123456789')).toBe('/orders/:id');
    expect(normalizePageUrlPattern('https://example.com/v2/page')).toBe('/v2/page');
  });

  it('returns "/" for the bare root URL', () => {
    expect(normalizePageUrlPattern('https://example.com')).toBe('/');
    expect(normalizePageUrlPattern('https://example.com/')).toBe('/');
  });

  it('returns null for a malformed/non-absolute URL rather than throwing', () => {
    expect(normalizePageUrlPattern('not-a-url')).toBeNull();
    expect(normalizePageUrlPattern('')).toBeNull();
  });
});

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'po-1',
    project_id: 'project-1',
    class_name: 'LoginPage',
    file_name: 'login-page.ts',
    page_label: 'Login',
    page_url_pattern: '/login',
    code: 'export class LoginPage {}',
    method_signatures: [],
    version: 1,
    ...overrides,
  };
}

describe('matchRegistryEntry', () => {
  it('does not match when the URL pattern is genuinely different (non-UUID dynamic segment)', () => {
    const registry = [makeEntry({ page_url_pattern: '/projects/:id/settings' })];
    // "9c21..." is not a real UUID/long-numeric shape, so normalizePageUrlPattern
    // won't collapse it to :id here - this intentionally exercises the "falls through
    // to label matching, finds nothing either" path rather than a URL match.
    const match = matchRegistryEntry(registry, { url: 'https://example.com/projects/9c21.../settings?tab=billing' });
    expect(match).toBeNull();
  });

  it('matches by URL pattern with a real UUID id segment', () => {
    const registry = [makeEntry({ page_url_pattern: '/projects/:id/settings' })];
    const match = matchRegistryEntry(registry, {
      url: 'https://example.com/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/settings?tab=billing',
    });
    expect(match?.page_url_pattern).toBe('/projects/:id/settings');
  });

  it('falls back to normalized label matching when no URL is given', () => {
    const registry = [makeEntry({ page_label: 'Login Page', page_url_pattern: '/login' })];
    const match = matchRegistryEntry(registry, { label: 'login page' }); // different casing/spacing
    expect(match).not.toBeNull();
  });

  it('returns null when neither URL pattern nor label matches anything (genuinely new page)', () => {
    const registry = [makeEntry()];
    const match = matchRegistryEntry(registry, { label: 'Checkout', url: 'https://example.com/checkout' });
    expect(match).toBeNull();
  });

  it('prefers URL match over label when both are present and could disagree', () => {
    const registry = [
      makeEntry({ id: 'po-a', class_name: 'LoginPageA', page_label: 'Sign In', page_url_pattern: '/login' }),
      makeEntry({ id: 'po-b', class_name: 'LoginPageB', page_label: 'Login', page_url_pattern: '/auth/login' }),
    ];
    // URL matches po-b's pattern exactly; label ("Sign In" normalized) doesn't match either
    // entry's label closely - URL should decide.
    const match = matchRegistryEntry(registry, { label: 'Sign In', url: 'https://example.com/auth/login' });
    expect(match?.id).toBe('po-b');
  });
});
