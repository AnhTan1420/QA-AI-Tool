import type { DocumentAtom } from '@/lib/validators/document';

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
// Chan tren so atom / do sau duyet cay, tranh 1 file Figma khong lo lam prompt
// AI phinh to qua muc hoac request treo qua lau.
const MAX_ATOMS = 300;
const MAX_DEPTH = 24;

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
export function flattenFigmaAtoms(root: FigmaNode): { atoms: DocumentAtom[]; screens: string[]; truncated: boolean } {
  const atoms: DocumentAtom[] = [];
  const screens: string[] = [];
  const usedIds = new Set<string>();
  let truncated = false;

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

  function walk(node: FigmaNode, screen: string, depth: number) {
    if (truncated || depth > MAX_DEPTH) return;
    if (atoms.length >= MAX_ATOMS) {
      truncated = true;
      return;
    }

    if (node.type === 'TEXT' && node.characters && node.characters.trim()) {
      const text = node.characters.trim();
      atoms.push({
        atom_id: makeAtomId(screen, node),
        atom_type: 'screen_element',
        label: text.slice(0, 120),
        detail: `Text layer "${node.name}" trên màn hình "${screen}": "${text.slice(0, 300)}"`,
        screen_or_section: screen,
      });
    } else if (INTERACTIVE_TYPES.has(node.type)) {
      atoms.push({
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
    if (truncated) break;
    const topLevelFrames = page.type === 'CANVAS' ? page.children ?? [] : [page];
    for (const frame of topLevelFrames) {
      if (truncated) break;
      const screenName = SCREEN_TYPES.has(frame.type) ? frame.name : page.name;
      if (!screens.includes(screenName)) screens.push(screenName);
      walk(frame, screenName, 0);
    }
  }

  return { atoms, screens, truncated };
}

/** Fetch + flatten 1 link Figma thanh danh sach DocumentAtom, san sang dua vao ParsedDocument. */
export async function fetchAndParseFigmaFile(
  figmaUrl: string,
  token: string,
): Promise<{ title: string; atoms: DocumentAtom[]; screens: string[]; truncated: boolean }> {
  if (!token) {
    throw new Error('Thiếu Figma Personal Access Token. Tạo token tại figma.com → Settings → Personal access tokens, hoặc cấu hình FIGMA_ACCESS_TOKEN trên server.');
  }

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const { title, root } = await fetchFigmaDocument(fileKey, nodeId, token);
  const { atoms, screens, truncated } = flattenFigmaAtoms(root);

  if (atoms.length === 0) {
    throw new Error('Không tìm thấy text layer/component nào trong file Figma này để phân tích.');
  }

  return { title, atoms, screens, truncated };
}
