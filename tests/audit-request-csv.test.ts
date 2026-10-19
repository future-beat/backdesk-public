/**
 * The optional Job List upload, as a pure acceptance decision (Phase 9,
 * LAND-02, D-10, threat T-9-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CAP IS 4 MiB, NOT THE 5 MB D-10 WROTE. Vercel Functions reject a     │
 * │ request body over 4.5 MB with a 413 the app never renders, and Server    │
 * │ Actions default to 1 MB (09-RESEARCH §5, Pitfall 1). Accepting a file    │
 * │ the platform will not carry is a promise broken on the first screen a    │
 * │ prospect fills in, so the app cap, `bodySizeLimit`, the console intake   │
 * │ cap and the bucket's own `file_size_limit` are ONE number — and the      │
 * │ assertions below are what keeps them one number.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: `sniffCsv` is handed a description of a file rather than a `File`, so
 * the decision is testable without a runtime, a request or a byte on disk. The
 * action reads `file.size` before it reads any bytes and hands the first 4 KB
 * here; that ordering lives in tests/audit-request-action.test.ts.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MAX_CSV_BYTES } from '@/core/audit/csv-mapping';
import {
  AUDIT_CSV_MAX_BYTES,
  sanitiseCsvFilename,
  sniffCsv,
} from '@/core/intake/csv-sniff';

const SOURCE = readFileSync('src/core/intake/csv-sniff.ts', 'utf8');

/** A believable ServiceM8 Job List first line. */
const HEADER = 'Job,Client\r\n1,Bob';

function file(overrides: Partial<Parameters<typeof sniffCsv>[0]> = {}) {
  return {
    name: 'jobs.csv',
    type: 'text/csv',
    size: 10,
    firstBytes: HEADER,
    ...overrides,
  };
}

describe('a real ServiceM8 export is accepted whatever MIME the browser guessed', () => {
  it('accepts text/csv and reports the column count', () => {
    expect(sniffCsv(file())).toEqual({ ok: true, columns: 2 });
  });

  /**
   * Windows Excel is installed on most of these machines and it claims the
   * .csv association: the browser then sends `application/vnd.ms-excel` for a
   * file that is plainly a CSV. `application/octet-stream` and an EMPTY type
   * are what an older Android picker and a drag-and-drop send. Refusing those
   * would refuse the export we asked for, from the tradie most likely to have
   * one — so the extension plus the parse is the real gate, not the MIME.
   */
  it.each(['application/vnd.ms-excel', 'application/octet-stream', ''])(
    'accepts a .csv named file whose MIME is %j',
    (type) => {
      expect(sniffCsv(file({ type }))).toEqual({ ok: true, columns: 2 });
    },
  );

  it('accepts a .CSV in any case', () => {
    expect(sniffCsv(file({ name: 'JOBS.CSV' }))).toEqual({ ok: true, columns: 2 });
  });

  it('sniffs a BOM-prefixed export, because Excel writes one', () => {
    expect(sniffCsv(file({ firstBytes: `﻿${HEADER}` }))).toEqual({
      ok: true,
      columns: 2,
    });
  });

  it('sniffs an LF-only export as well as the CRLF one', () => {
    expect(sniffCsv(file({ firstBytes: 'Job,Client\n1,Bob' }))).toEqual({
      ok: true,
      columns: 2,
    });
  });
});

describe('what is refused, and with which of the two sentences', () => {
  it('refuses a spreadsheet by extension', () => {
    expect(sniffCsv(file({ name: 'jobs.xlsx', type: 'text/csv' }))).toEqual({
      ok: false,
      kind: 'type',
    });
  });

  it('refuses a MIME outside the allowlist even with a .csv name', () => {
    expect(sniffCsv(file({ type: 'application/pdf' }))).toEqual({
      ok: false,
      kind: 'type',
    });
  });

  /**
   * A single column is a text file somebody renamed, or an export of one
   * field. Either way the audit cannot be built from it, and finding that out
   * now costs the prospect one sentence rather than a day of waiting.
   */
  it('refuses a first line with only one column', () => {
    expect(sniffCsv(file({ firstBytes: 'Job\n1' }))).toEqual({ ok: false, kind: 'type' });
  });

  it('refuses an empty file with the TYPE sentence, not the size one', () => {
    expect(sniffCsv(file({ size: 0, firstBytes: '' }))).toEqual({
      ok: false,
      kind: 'type',
    });
  });

  it('accepts exactly the cap and refuses one byte past it', () => {
    expect(sniffCsv(file({ size: 4194304 }))).toEqual({ ok: true, columns: 2 });
    expect(sniffCsv(file({ size: 4194305 }))).toEqual({ ok: false, kind: 'size' });
  });
});

describe('the stored filename is the prospect’s, made safe', () => {
  it('maps everything outside [A-Za-z0-9._-] to an underscore', () => {
    expect(sanitiseCsvFilename('Job List (Aug).csv')).toBe('Job_List__Aug_.csv');
  });

  /**
   * The name becomes the second segment of a storage object key and the
   * `filename=` of a Content-Disposition header on the operator's download
   * (09-06). A traversal segment or a quote in either place is a bug with
   * consequences, and neither survives the character class.
   */
  it('cannot carry a path segment or a quote out of this function', () => {
    const safe = sanitiseCsvFilename('../../etc/pa"sswd.csv');
    expect(safe).not.toContain('/');
    expect(safe).not.toContain('"');
    expect(safe).toBe('.._.._etc_pa_sswd.csv');
  });

  it('always ends in .csv, even when the prospect renamed it', () => {
    expect(sanitiseCsvFilename('joblist')).toBe('joblist.csv');
    expect(sanitiseCsvFilename('')).toBe('export.csv');
  });

  it('caps the result at 80 characters, suffix included', () => {
    const long = `${'a'.repeat(200)}.csv`;
    const safe = sanitiseCsvFilename(long);
    expect(safe.length).toBeLessThanOrEqual(80);
    expect(safe.endsWith('.csv')).toBe(true);
  });
});

describe('one number across the public form, the console intake and the bucket', () => {
  it('caps the public upload at 4 MiB (the D-10 deviation, RESEARCH §5)', () => {
    expect(AUDIT_CSV_MAX_BYTES).toBe(4 * 1024 * 1024);
    // 4,194,304 — the same integer migration 0035 wrote into
    // storage.buckets.file_size_limit for `audit-uploads`.
    expect(AUDIT_CSV_MAX_BYTES).toBe(4194304);
  });

  /**
   * The console's own intake must not be SMALLER than the public one, or
   * 09-06's pre-fill rejects a file this form already accepted and stored —
   * an operator staring at a request whose attachment cannot be used.
   */
  it('keeps the console intake cap equal to the public cap', () => {
    expect(MAX_CSV_BYTES).toBe(AUDIT_CSV_MAX_BYTES);
  });

  it('states the platform body limit in next.config.ts', () => {
    const config = readFileSync('next.config.ts', 'utf8');
    expect(config).toContain('4400kb');
    expect(config).toContain('bodySizeLimit');
  });
});

describe('the module stays pure (the src/core rule)', () => {
  it('imports papaparse and nothing framework-shaped', () => {
    expect(SOURCE).toContain('papaparse');
    expect(SOURCE).not.toMatch(/from 'next\//);
    expect(SOURCE).not.toMatch(/from '@\/db/);
  });

  /** The two refusal sentences are the copy module's, not this one's. */
  it('holds no prose a prospect could read', () => {
    expect(SOURCE).not.toContain("isn't a CSV");
    expect(SOURCE).not.toContain('over 4 MB');
  });
});
