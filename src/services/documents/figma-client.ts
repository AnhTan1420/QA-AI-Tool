import type { DocumentAtom } from '@/models/validators/document';

// ============================================================================
// File: figma-client.ts
// Chuc nang: Doc 1 file Figma qua REST API chinh thuc va "atomize" toan bo cay
// node thanh DocumentAtom (moi text layer / component instance -> 1 atom).
// Khac voi anh diagram (parse qua Gemini Vision, co the "doan sai"), o day ta
// di THANG vao du lieu co cau truc that cua Figma -> liet ke DUOC MOI phan tu
// tren canvas mot cach tat dinh (deterministic), day chinh la co so de dat
// "mapping 100%" that su thay vi chi tin loi AI.
// ============================================================================

type FigmaNode = {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
};

type FigmaFileResponse = {
  name: string;
  document: FigmaNode;
};

type FigmaNodesResponse = {
  name?: string;
  nodes: Record<string, { document: FigmaNode } | null>;
};

const FIGMA_API_BASE = 'https://api.figma.com/v1';
// Chan tren so atom / do sau duyet cay, tranh 1 file Figma khong lo lam request
// treo qua lau. TRUOC DAY la hang so cung MAX_ATOMS = 300 va duyet theo THU TU
// man hinh — nghia la mot design system co nhieu man hinh se BI CAT GIUA CHUNG,
// va cac man hinh xuat hien SAU trong file khong bao gio tro thanh atom. Day la
// cung mot loi voi capText(24000) o Reader: gioi han la hop ly, nhung ap dung
// no bang cach cat cut theo thu tu duyet la sai — no thien vi phan dau file.
//
// Sua: (1) nang tran mac dinh va cho cau hinh qua env — 300 la qua thap cho
// mot he thong thiet ke thuc te; (2) duyet HET moi man hinh cho toi khi cham
// tran, roi chon RAI DEU tren tat ca cac man hinh thay vi lay dung N atom dau
// tien — nhu vay neu phai cat, moi man hinh deu mat mot phan bang nhau thay vi
// cac man hinh cuoi bi xoa so hoan toan.
function getFigmaMaxAtoms(): number {
  const raw = process.env.AI_FIGMA_MAX_ATOMS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? Math.min(20_000, Math.max(50, parsed)) : 2_000;
}
const MAX_DEPTH = 32;

const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET']);
const INTERACTIVE_TYPES = new Set(['INSTANCE', 'COMPONENT']);

/**
 * Parse 1 link Figma (file/design/proto) thanh { fileKey, nodeId }.
 * Ho tro ca 2 dinh dang node-id: kieu cu "1%3A2" (":" ma hoa) va kieu moi
 * "1-2" (dau gach ngang) ma Figma dung trong link share gan day.
 */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Link Figma không hợp lệ.');
  }

  const match = parsed.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) {
    throw new Error('Không tìm thấy file key trong link Figma. Hãy dùng link dạng figma.com/design/<key>/... hoặc figma.com/file/<key>/...');
  }
  const fileKey = match[2];

  const rawNodeId = parsed.searchParams.get('node-id');
  let nodeId: string | undefined;
  if (rawNodeId) {
    const decoded = decodeURIComponent(rawNodeId);
    nodeId = decoded.includes(':') ? decoded : decoded.replace('-', ':');
  }

  return { fileKey, nodeId };
}

async function fetchFigmaDocument(
  fileKey: string,
  nodeId: string | undefined,
  token: string,
): Promise<{ title: string; root: FigmaNode }> {
  const headers = { 'X-Figma-Token': token };

  if (nodeId) {
    const res = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, { headers });
    if (!res.ok) {
      throw new Error(`Figma API lỗi (${res.status}): không đọc được node đã chọn. Kiểm tra lại link/token/quyền truy cập file.`);
    }
    const data = (await res.json()) as FigmaNodesResponse;
    const entry = Object.values(data.nodes ?? {}).find((v) => v?.document);
    if (!entry?.document) {
      throw new Error('Không tìm thấy node trong file Figma (node-id có thể đã bị xoá hoặc sai link).');
    }
    return { title: data.name || entry.document.name, root: entry.document };
  }

  const res = await fetch(`${FIGMA_API_BASE}/files/${fileKey}`, { headers });
  if (!res.ok) {
    throw new Error(`Figma API lỗi (${res.status}): kiểm tra lại link file và Personal Access Token.`);
  }
  const data = (await res.json()) as FigmaFileResponse;
  return { title: data.name, root: data.document };
}

function sanitizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'node';
}

/**
 * Duyet cay node cua Figma va liet ke tat dinh moi TEXT layer + component
 * tuong tac thanh DocumentAtom. Day la ham thuan (khong goi network) nen co
 * the unit-test doc lap voi flow API.
 */
export function flattenFigmaAtoms(
  root: FigmaNode,
  options: { maxAtoms?: number } = {},
): { atoms: DocumentAtom[]; screens: string[]; truncated: boolean; atoms_before_cap: number } {
  const maxAtoms = options.maxAtoms ?? getFigmaMaxAtoms();
  // Gom TAT CA atom theo tung man hinh truoc, KHONG cat giua chung — cat theo
  // man hinh (neu can) chi xay ra sau khi da thay toan canh.
  const byScreen = new Map<string, DocumentAtom[]>();
  const screens: string[] = [];
  const usedIds = new Set<string>();

  function makeAtomId(screen: string, node: FigmaNode): string {
    const base = `FIG_${sanitizeSlug(screen)}_${sanitizeSlug(node.name)}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id;
  }

  function pushAtom(screen: string, atom: DocumentAtom) {
    const list = byScreen.get(screen) ?? [];
    list.push(atom);
    byScreen.set(screen, list);
  }

  function walk(node: FigmaNode, screen: string, depth: number) {
    if (depth > MAX_DEPTH) return;

    if (node.type === 'TEXT' && node.characters && node.characters.trim()) {
      const text = node.characters.trim();
      pushAtom(screen, {
        atom_id: makeAtomId(screen, node),
        atom_type: 'screen_element',
        label: text.slice(0, 120),
        detail: `Text layer "${node.name}" trên màn hình "${screen}": "${text.slice(0, 300)}"`,
        screen_or_section: screen,
      });
    } else if (INTERACTIVE_TYPES.has(node.type)) {
      pushAtom(screen, {
        atom_id: makeAtomId(screen, node),
        atom_type: 'screen_element',
        label: node.name,
        detail: `Component tương tác "${node.name}" (${node.type}) trên màn hình "${screen}".`,
        screen_or_section: screen,
      });
    }

    for (const child of node.children ?? []) {
      walk(child, screen, depth + 1);
    }
  }

  // DOCUMENT -> pages (CANVAS) -> top-level frames = "man hinh". Neu root da
  // la 1 node cu the (fetch qua node-id), coi luon chinh no la 1 "trang".
  const pages = root.type === 'DOCUMENT' ? root.children ?? [] : [root];
  for (const page of pages) {
    const topLevelFrames = page.type === 'CANVAS' ? page.children ?? [] : [page];
    for (const frame of topLevelFrames) {
      const screenName = SCREEN_TYPES.has(frame.type) ? frame.name : page.name;
      if (!screens.includes(screenName)) screens.push(screenName);
      walk(frame, screenName, 0);
    }
  }

  const totalAtoms = [...byScreen.values()].reduce((n, list) => n + list.length, 0);
  if (totalAtoms <= maxAtoms) {
    return { atoms: [...byScreen.values()].flat(), screens, truncated: false, atoms_before_cap: totalAtoms };
  }

  // Vuot tran: lay RAI DEU tren tung man hinh (ty le thuan voi kich thuoc man
  // hinh do) thay vi lay dung N atom dau tien — nhu vay man hinh cuoi cung
  // trong file van co mat trong ket qua, chi la it chi tiet hon.
  const screenNames = [...byScreen.keys()];
  const perScreenShare = screenNames.map((name) => {
    const count = byScreen.get(name)!.length;
    return { name, count, share: Math.max(1, Math.floor((count / totalAtoms) * maxAtoms)) };
  });

  const sampled: DocumentAtom[] = [];
  for (const { name, share } of perScreenShare) {
    sampled.push(...byScreen.get(name)!.slice(0, share));
  }

  return { atoms: sampled.slice(0, maxAtoms), screens, truncated: true, atoms_before_cap: totalAtoms };
}

/** Fetch + flatten 1 link Figma thanh danh sach DocumentAtom, san sang dua vao ParsedDocument. */
export async function fetchAndParseFigmaFile(
  figmaUrl: string,
  token: string,
): Promise<{ title: string; atoms: DocumentAtom[]; screens: string[]; truncated: boolean; atoms_before_cap: number }> {
  if (!token) {
    throw new Error('Thiếu Figma Personal Access Token. Tạo token tại figma.com → Settings → Personal access tokens, hoặc cấu hình FIGMA_ACCESS_TOKEN trên server.');
  }

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const { title, root } = await fetchFigmaDocument(fileKey, nodeId, token);
  const result = flattenFigmaAtoms(root);

  if (result.atoms.length === 0) {
    throw new Error('Không tìm thấy text layer/component nào trong file Figma này để phân tích.');
  }

  return { title, ...result };
}
