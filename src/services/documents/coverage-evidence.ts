// ============================================================================
// File: src/services/documents/coverage-evidence.ts
// BANG CHUNG NGU NGHIA cho mapping atom ↔ test case.
// ----------------------------------------------------------------------------
// Van de: "atom_id co mat trong source_requirement_ids" KHONG chung minh duoc
// test case that su KIEM TRA atom do. Model chi can dan them 1 chuoi ID vao
// mang la coverage nhay len 100% — day dung la cach an gian ma muc 17 cam.
//
// Giai phap: cham diem bang CODE, khong hoi lai AI.
//   1. Rut ra cac "thuat ngu dac trung" cua atom (label + detail + section):
//      chuoi trong ngoac kep, dinh danh ky thuat (users.status), rang buoc
//      (NOT NULL, UNIQUE), con so bien, va tu dai co nghia.
//   2. Doi chieu voi TOAN BO noi dung test case: title, tung step (action +
//      expected_result), final_expected_result, preconditions, test_data.
//   3. Ket luan: co bang chung / khong co bang chung.
//
// Day la HEURISTIC co chu dich — no khong khang dinh "test nay dung", chi
// khang dinh "test nay co that su nhac den thu ma atom mo ta hay khong". Mot
// mapping khong co lay 1 tu nao trung voi yeu cau goc gan nhu chac chan la
// mapping gia.
// ============================================================================

import type { DocumentAtom } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

/** Bo dau tieng Viet + ha thuong, de so khop khong phu thuoc dau/hoa-thuong. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

// Tu dung (stopword) Viet + Anh — khong mang thong tin phan biet.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'then', 'must', 'should', 'will',
  'shall', 'have', 'has', 'been', 'into', 'over', 'under', 'each', 'any', 'all', 'not', 'are',
  'was', 'were', 'can', 'may', 'field', 'value', 'user', 'users', 'system', 'screen', 'page',
  'button', 'input', 'label', 'text', 'element', 'component', 'display', 'displayed', 'show',
  'shown', 'verify', 'check', 'test', 'case', 'step', 'result', 'expected', 'action',
  'nguoi', 'dung', 'he', 'thong', 'man', 'hinh', 'truong', 'gia', 'tri', 'duoc', 'khong', 'phai',
  'cua', 'cho', 'voi', 'khi', 'neu', 'thi', 'va', 'hoac', 'cac', 'nhung', 'mot', 'nay', 'do',
  'kiem', 'tra', 'hien', 'thi', 'nhap', 'bam', 'nut', 'trang',
]);

export type EvidenceTerms = {
  /** Thuat ngu manh: 1 tu khop la du (chuoi trich dan, dinh danh, rang buoc, so). */
  strong: string[];
  /** Thuat ngu thuong: can ty le khop toi thieu. */
  weak: string[];
};

/**
 * Rut thuat ngu dac trung tu 1 atom. Lay tu label + detail + screen_or_section
 * — KHONG lay atom_id, vi chinh atom_id la thu dang bi nghi ngo (model chi can
 * chep ID vao la xong, nen no khong the vua la bang chung vua la thu can chung minh).
 */
export function extractAtomTerms(atom: Pick<DocumentAtom, 'label' | 'detail' | 'screen_or_section'>): EvidenceTerms {
  const source = [atom.label, atom.detail, atom.screen_or_section].filter(Boolean).join(' ');
  const strong = new Set<string>();
  const weak = new Set<string>();

  // 1) Chuoi trong ngoac kep/nhay/backtick — thuong la nhan UI hoac thong bao loi
  //    nguyen van trong thiet ke. Day la bang chung manh nhat.
  for (const match of source.matchAll(/["'“”‘’`]([^"'“”‘’`]{2,60})["'“”‘’`]/g)) {
    const term = normalizeForMatch(match[1]).trim();
    if (term.length >= 2) strong.add(term);
  }

  // 2) Dinh danh ky thuat: users.status, created_at, max_length, API path.
  for (const match of source.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+)\b/g)) {
    strong.add(normalizeForMatch(match[1]));
  }

  // 3) Rang buoc CSDL/nghiep vu duoc viet hoa.
  for (const match of source.matchAll(/\b(NOT NULL|UNIQUE|PRIMARY KEY|FOREIGN KEY|CASCADE|RESTRICT|DEFAULT|CHECK)\b/g)) {
    strong.add(normalizeForMatch(match[1]));
  }

  // 4) Con so — gia tri bien (max length, so lan thu, khoang gia tri). Chi coi
  //    la thuat ngu MANH khi tu 2 chu so tro len: mot con so 1 chu so xuat hien
  //    o qua nhieu cho (so thu tu step, ma case) de lam bang chung dang tin.
  for (const match of source.matchAll(/\b(\d{1,12}(?:[.,]\d+)?)\b/g)) {
    if (match[1].length >= 2) strong.add(match[1]);
    else weak.add(match[1]);
  }

  // 5) Tu thuong con lai, do dai >= 4, khong phai stopword.
  for (const raw of normalizeForMatch(source).split(/[^a-z0-9._-]+/)) {
    const word = raw.trim();
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    if (strong.has(word)) continue;
    weak.add(word);
  }

  return {
    strong: [...strong],
    // Uu tien tu DAI (dac trung hon) va gioi han so luong de 1 atom co detail
    // dai dong khong bi doi hoi mot ty le khop phi thuc te.
    weak: [...weak].sort((a, b) => b.length - a.length).slice(0, 12),
  };
}

export type Haystack = {
  /** Chuoi day du — dung cho cum tu nhieu chu. */
  text: string;
  /** Tap token — dung cho tu don. */
  tokens: Set<string>;
};

/** Tach chuoi thanh token, giu ca dang day du (users.status) lan dang tach roi. */
export function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of value.split(/[^a-z0-9._-]+/)) {
    const token = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (!token) continue;
    tokens.add(token);
    // users.status -> them ca "users" va "status"; created_at -> "created", "at".
    if (/[._-]/.test(token)) {
      for (const part of token.split(/[._-]+/)) {
        if (part) tokens.add(part);
      }
    }
  }
  return tokens;
}

/** Gom TOAN BO noi dung co the quan sat duoc cua 1 test case thanh 1 chuoi. */
export function buildTestCaseHaystack(testCase: GeneratedTestCase): Haystack {
  const parts: string[] = [testCase.title, testCase.final_expected_result, ...(testCase.preconditions ?? [])];
  for (const step of testCase.steps ?? []) {
    parts.push(step.action, step.expected_result);
  }
  for (const [key, value] of Object.entries(testCase.test_data ?? {})) {
    parts.push(key, String(value));
  }
  const text = normalizeForMatch(parts.join(' \n '));
  return { text, tokens: tokenize(text) };
}

/**
 * So khop MOT thuat ngu voi noi dung test case.
 *
 * Cum tu nhieu chu -> so khop chuoi con (nhan UI "Create Account" phai xuat
 * hien nguyen cum). Tu don -> so khop TOKEN, khong phai chuoi con: neu dung
 * chuoi con thi thuat ngu "1" (mot gia tri bien) se khop voi "TC_DOC_001" va
 * moi mapping gia deu tro thanh hop le.
 */
function matchesTerm(term: string, haystack: Haystack): boolean {
  if (/\s/.test(term)) return haystack.text.includes(term);
  if (haystack.tokens.has(term)) return true;
  // Thuat ngu co dau cham/gach (users.status) van tinh la khop neu moi thanh
  // phan deu xuat hien — model hay viet "cot status cua bang users".
  if (/[._-]/.test(term)) {
    const parts = term.split(/[._-]+/).filter(Boolean);
    return parts.length > 1 && parts.every((part) => haystack.tokens.has(part));
  }
  return false;
}

export type MappingEvidence = {
  has_evidence: boolean;
  /** 0..1 — ty le thuat ngu dac trung xuat hien trong test case. */
  score: number;
  matched_terms: string[];
  /** Ly do ngan gon, dung cho bang audit va cho prompt repair. */
  reason: string;
};

/** Nguong ty le thuat ngu thuong can khop khi khong co thuat ngu manh nao. */
const WEAK_TERM_RATIO = 0.34;

/**
 * Cham diem bang chung cho mot cap (atom, test case).
 *
 * Quy tac:
 *   • Khop >= 1 thuat ngu MANH  -> co bang chung.
 *   • Khong co thuat ngu manh   -> can khop >= 34% thuat ngu thuong (toi thieu 1).
 *   • Atom khong co thuat ngu dac trung nao (label rat ngan, chung chung)
 *     -> KHONG ket toi: tra ve co bang chung, vi ta khong du co so de phan doi.
 */
export function assessMappingEvidence(
  atom: Pick<DocumentAtom, 'label' | 'detail' | 'screen_or_section'>,
  testCase: GeneratedTestCase,
  haystack?: Haystack,
): MappingEvidence {
  const terms = extractAtomTerms(atom);
  const hay = haystack ?? buildTestCaseHaystack(testCase);

  const totalTerms = terms.strong.length + terms.weak.length;
  if (totalTerms === 0) {
    return {
      has_evidence: true,
      score: 1,
      matched_terms: [],
      reason: 'Atom không có thuật ngữ đặc trưng để đối chiếu — không đủ cơ sở để coi là mapping giả.',
    };
  }

  const matchedStrong = terms.strong.filter((term) => matchesTerm(term, hay));
  const matchedWeak = terms.weak.filter((term) => matchesTerm(term, hay));
  const matched = [...matchedStrong, ...matchedWeak];
  const score = matched.length / totalTerms;

  if (matchedStrong.length > 0) {
    return {
      has_evidence: true,
      score,
      matched_terms: matched,
      reason: `Test case nhắc tới ${matchedStrong.length} thuật ngữ đặc trưng của atom (${matchedStrong.slice(0, 3).join(', ')}).`,
    };
  }

  const needed = Math.max(1, Math.ceil(terms.weak.length * WEAK_TERM_RATIO));
  if (matchedWeak.length >= needed) {
    return {
      has_evidence: true,
      score,
      matched_terms: matched,
      reason: `Test case khớp ${matchedWeak.length}/${terms.weak.length} thuật ngữ của atom.`,
    };
  }

  return {
    has_evidence: false,
    score,
    matched_terms: matched,
    reason: `Test case không nhắc tới nội dung của atom (khớp ${matched.length}/${totalTerms} thuật ngữ). Nhiều khả năng atom_id được gán vào mà không thực sự kiểm tra yêu cầu này.`,
  };
}

/** Bat/tat cong tac "coverage phai co bang chung ngu nghia" (mac dinh: BAT). */
export function isSemanticEvidenceRequired(): boolean {
  const raw = process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}
