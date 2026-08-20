import type { GeneratedTestCase } from '@/models/validators/test-case';

// ============================================================================
// File: test-case-similarity.ts
// Chuc nang: Phat hien case CO THE bi trung/gan trung sau khi AI generate.
// ============================================================================
//
// TAI SAO KHONG DUNG /api/ai/embed (da co san) CHO VIEC NAY:
// Embed API goi 1 request rieng cho MOI test case (chi nhan 1 "content" string
// / lan) - voi 1 set 30-40+ case, kiem tra trung lap se can 30-40+ AI call
// them (tinh phi + do tre + an vao cung 1 quota rate-limit voi luong generate
// chinh). review-agent.ts cung da co issue_type "duplicate" nhung do la ket
// qua CUA 1 LAN GOI REVIEW rieng (AI doc lai toan bo set) - muon co canh bao
// tuc thi NGAY SAU KHI GENERATE (truoc ca khi bam "Chay Review"), can 1 phep do
// hoan toan local. Vi vay dung TOKEN-OVERLAP (Jaccard) o client, khong ton AI
// call nao, chay tuc thi ke ca voi set lon - bo sung (khong thay the) cho
// "duplicate" o Review.
//
// Nguong (SIMILARITY_THRESHOLD) co the chinh lai neu qua nhay/qua "lo dieu".

const SIMILARITY_THRESHOLD = 0.55;

// Vietnamese/English stopwords + tu ngu chung chung hay lap lai trong moi test
// case (VD "test", "kiem tra", "he thong") - loai bo de tranh 2 case CHI giong
// nhau o cac tu nay bi tinh nham la trung lap.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'or', 'with', 'for', 'in', 'on', 'at', 'this', 'that',
  'test', 'case', 'kiem', 'tra', 'he', 'thong', 'khi', 'la', 'va', 'voi', 'cho', 'mot', 'cac', 'duoc', 'khong',
  'nguoi', 'dung', 'du', 'lieu', 'man', 'hinh', 'chuc', 'nang',
]);

/** Bo dau tieng Viet (NFD normalize + strip combining marks) de "mật khẩu" va
 * "mat khau" duoc coi la cung 1 token khi so sanh - tranh bo sot trung lap chi
 * vi 1 ban co dau, 1 ban khong (hay xay ra khi AI khong nhat quan giua cac case). */
function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd');
}

function tokenize(text: string): Set<string> {
  const normalized = stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
  return new Set(normalized);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** "Chu ky noi dung" cua 1 test case dung de so sanh: title la tin hieu manh
 * nhat (thuong phan anh dung "kich ban" dang test), cong them
 * final_expected_result de phan biet 2 case cung title nhung khac ket qua
 * mong doi (VD "voi role Admin" vs "voi role User" co the bi rut gon title
 * giong nhau nhung ket qua khac han). */
function fingerprint(tc: GeneratedTestCase): Set<string> {
  const text = [tc.title ?? '', tc.final_expected_result ?? ''].join(' ');
  return tokenize(text);
}

export type DuplicateWarning = {
  /** code cua case DANG duoc xem (key cua Map tra ve boi findPotentialDuplicates) */
  code: string;
  /** cac case khac ma no giong, kem % tuong dong (0-100, da lam tron) */
  similarTo: { code: string; title: string; score: number }[];
};

/** Tra ve Map<code cua case, canh bao trung lap cua rieng case do>. Chi cac case
 * THUC SU co it nhat 1 case khac vuot nguong moi xuat hien trong Map (case
 * "sach" khong co key rieng) - goi tien ich o noi dung O(1) tra cuu theo code. */
export function findPotentialDuplicates(testCases: GeneratedTestCase[]): Map<string, DuplicateWarning> {
  const result = new Map<string, DuplicateWarning>();
  const valid = testCases.filter((tc): tc is GeneratedTestCase => !!tc?.code);
  const fingerprints = valid.map((tc) => fingerprint(tc));

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const score = jaccardSimilarity(fingerprints[i], fingerprints[j]);
      if (score < SIMILARITY_THRESHOLD) continue;

      const a = valid[i];
      const b = valid[j];
      const pct = Math.round(score * 100);

      const entryA = result.get(a.code) ?? { code: a.code, similarTo: [] };
      entryA.similarTo.push({ code: b.code, title: b.title, score: pct });
      result.set(a.code, entryA);

      const entryB = result.get(b.code) ?? { code: b.code, similarTo: [] };
      entryB.similarTo.push({ code: a.code, title: a.title, score: pct });
      result.set(b.code, entryB);
    }
  }

  return result;
}
