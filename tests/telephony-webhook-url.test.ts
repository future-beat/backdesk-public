/**
 * THE ONE URL BUILDER, PINNED (Phase 11, D-05, T-11-11).
 *
 * Twilio signs the exact URL configured on a number, query string included,
 * and the voice routes rebuild that URL from configuration to check the
 * signature. So the builder's output is not a detail: provisioning writes it
 * onto a live number, and one byte of difference — a trailing slash, a double
 * slash, the wrong secret, the wrong host — fails every real call's signature
 * while Twilio's own debugger reports 200s. These are exact-string assertions
 * for that reason.
 *
 * AND IT FAILS CLOSED. `APP_BASE_URL` is optional in the env schema, and the
 * alert-email origin resolver falls back to Vercel's injected production domain
 * when it is absent — which can be the marketing apex. The telephony builder
 * must return `null` instead of inheriting that fallback, and the last test
 * pins that the fallback's names do not appear in its source at all.
 *
 * Pure: the builder takes its env slice as an argument.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TWILIO_ROUTE_TOKEN_PATTERN } from '@/core/shared/env';
import {
  TWILIO_WEBHOOK_ROUTES,
  twilioWebhookHost,
  twilioWebhookUrl,
} from '@/core/telephony/webhook-url';

/** 64 hex — the `openssl rand -hex 32` shape both route secrets have. */
const VOICE_SECRET = 'a1'.repeat(32);
const STATUS_SECRET = 'b2'.repeat(32);
const BASE = 'https://app.backdesk.com.au';

const ENV = {
  APP_BASE_URL: BASE,
  TWILIO_VOICE_WEBHOOK_SECRET: VOICE_SECRET,
  TWILIO_VOICE_STATUS_WEBHOOK_SECRET: STATUS_SECRET,
};

const SOURCE = readFileSync('src/core/telephony/webhook-url.ts', 'utf8');

describe('twilioWebhookUrl', () => {
  it('builds the voice URL exactly, with the VOICE secret', () => {
    expect(twilioWebhookUrl('voice', ENV)).toBe(
      `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=${VOICE_SECRET}`,
    );
  });

  it('builds the status URL with the STATUS secret, never the voice one (four-bearer rule)', () => {
    const url = twilioWebhookUrl('voice-status', ENV);

    expect(url).toBe(
      `https://app.backdesk.com.au/api/webhooks/twilio/voice-status?token=${STATUS_SECRET}`,
    );
    expect(url).not.toContain(VOICE_SECRET);
  });

  it('the voice URL does not carry the status secret either', () => {
    expect(twilioWebhookUrl('voice', ENV)).not.toContain(STATUS_SECRET);
  });

  it('a base with a trailing slash (or several) yields no double slash', () => {
    for (const base of [`${BASE}/`, `${BASE}//`]) {
      expect(twilioWebhookUrl('voice', { ...ENV, APP_BASE_URL: base })).toBe(
        `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=${VOICE_SECRET}`,
      );
    }
  });

  it('FAILS CLOSED: null when APP_BASE_URL is unset or empty', () => {
    expect(twilioWebhookUrl('voice', { ...ENV, APP_BASE_URL: undefined })).toBeNull();
    expect(twilioWebhookUrl('voice-status', { ...ENV, APP_BASE_URL: undefined })).toBeNull();
    expect(twilioWebhookUrl('voice', { ...ENV, APP_BASE_URL: '' })).toBeNull();
  });

  it('starts with https:// and has no trailing slash on the path', () => {
    for (const route of Object.keys(TWILIO_WEBHOOK_ROUTES) as (keyof typeof TWILIO_WEBHOOK_ROUTES)[]) {
      const url = twilioWebhookUrl(route, ENV)!;
      expect(url.startsWith('https://')).toBe(true);
      expect(url.endsWith('/')).toBe(false);
      expect(new URL(url).pathname.endsWith('/')).toBe(false);
    }
  });

  it('encoding is a no-op on the hex token — the string written and the string rebuilt are one', () => {
    const url = twilioWebhookUrl('voice', ENV)!;
    expect(new URL(url).searchParams.get('token')).toBe(VOICE_SECRET);
    expect(url.endsWith(`?token=${VOICE_SECRET}`)).toBe(true);
  });

  it('ENCODES a token the schema would refuse, so it still round-trips exactly (WR-04)', () => {
    // Belt to the schema's braces: `+` would decode to a space, `&` and `#`
    // would truncate. Encoded, `searchParams.get` hands back the secret itself.
    const nasty = 'ab+cd&ef#gh=ij%kl mn/op';
    const url = twilioWebhookUrl('voice', { ...ENV, TWILIO_VOICE_WEBHOOK_SECRET: nasty })!;

    expect(new URL(url).searchParams.get('token')).toBe(nasty);
    expect(url).not.toContain('#');
    expect(url).not.toContain('&');
  });

  it('the route paths are the two route files, with no trailing slash', () => {
    expect(TWILIO_WEBHOOK_ROUTES).toEqual({
      voice: '/api/webhooks/twilio/voice',
      'voice-status': '/api/webhooks/twilio/voice-status',
    });
  });
});

describe('TWILIO_ROUTE_TOKEN_PATTERN — the two route tokens are URL-safe hex (WR-04)', () => {
  it('accepts the `openssl rand -hex 32` shape, and the CI dummies', () => {
    for (const ok of [
      VOICE_SECRET,
      STATUS_SECRET,
      'ca11ab1e' + '0'.repeat(56),
      '57a7c0de' + '0'.repeat(56),
    ]) {
      expect(TWILIO_ROUTE_TOKEN_PATTERN.test(ok)).toBe(true);
    }
  });

  it.each([
    ['base64 with + and /', 'A'.repeat(60) + '+/=='],
    ['upper-case hex', 'A1'.repeat(32)],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['an ampersand', 'a'.repeat(63) + '&'],
    ['a space', 'a'.repeat(63) + ' '],
  ])('refuses %s', (_label, value) => {
    expect(TWILIO_ROUTE_TOKEN_PATTERN.test(value)).toBe(false);
  });
});

describe('twilioWebhookHost', () => {
  it('returns the configured host', () => {
    expect(twilioWebhookHost(ENV)).toBe('app.backdesk.com.au');
  });

  it('returns null when APP_BASE_URL is unset', () => {
    expect(twilioWebhookHost({ APP_BASE_URL: undefined })).toBeNull();
  });
});

describe('the builder never inherits the Vercel-domain fallback', () => {
  it('its source names neither the fallback variable nor the alert resolver', () => {
    // Raw source, comments INCLUDED: the header describes the fallback it
    // refuses without naming it, so the only way these strings can appear is
    // somebody reaching for them.
    expect(SOURCE).not.toContain('VERCEL_PROJECT_PRODUCTION_URL');
    expect(SOURCE).not.toContain('consoleBaseUrl');
  });

  it('never reads the incoming request', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/request\./);
    expect(code).not.toMatch(/x-forwarded/i);
  });
});
