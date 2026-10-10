import { MESH_CLEANUP } from "../tuning";

type Point = [number, number, number];
type Face = [number, number, number];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Point) => Math.hypot(...a);
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Worker-only cleanup. Exact welding preserves distinct nearby sheets.
 * Open edges and a border collar are immutable. sources maps output faces
 * back to their original flat paint attributes. */
export function cleanMesh(input: Float32Array, origin: Point, size: number, cell: number, refine = true) {
  const points: Point[] = [], faces: Face[] = [], incident: number[][] = [];
  const ids = new Map<string, number>();
  const edges = new Map<string, { a: number; b: number; opposite: number[] }>();
  for (let i = 0; i < input.length; i += 9) {
    const face = [0, 3, 6].map(offset => {
      const p: Point = [input[i + offset], input[i + offset + 1], input[i + offset + 2]];
      const key = p.join(",");
      let id = ids.get(key);
      if (id === undefined) { id = points.length; ids.set(key, id); points.push(p); incident.push([]); }
      incident[id].push(faces.length);
      return id;
    }) as Face;
    faces.push(face);
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], key = edgeKey(a, b);
      const edge = edges.get(key) ?? { a, b, opposite: [] };
      edge.opposite.push(face[(j + 2) % 3]); edges.set(key, edge);
    }
  }
  const locked = points.map(p => p.some((v, axis) => v <= origin[axis] + cell || v >= origin[axis] + size - cell));
  for (const e of edges.values()) if (e.opposite.length !== 2) locked[e.a] = locked[e.b] = true;
  const normal = (f: Face, replacement = -1, p?: Point) => {
    const [a, b, c] = f.map(id => id === replacement ? p! : points[id]);
    return cross(sub(b, a), sub(c, a));
  };
  // Needle tips have a narrow neighbour ring below them. Broad ridges fail
  // this test. Validate all incident faces before moving; never delete faces.
  for (let id = 0; id < points.length; id++) {
    if (locked[id]) continue;
    const neighbours = [...new Set(incident[id].flatMap(f => faces[f]))].filter(v => v !== id);
    if (neighbours.length < 3) continue;
    const center: Point = [0, 0, 0];
    for (const v of neighbours) for (let a = 0; a < 3; a++) center[a] += points[v][a] / neighbours.length;
    const axis = sub(points[id], center), height = length(axis);
    if (height < MESH_CLEANUP.tipMinHeight) continue;
    const direction = axis.map(v => v / height) as Point;
    let radius = 0, depth = 0;
    for (const v of neighbours) {
      const delta = sub(points[v], center), along = dot(delta, direction);
      radius = Math.max(radius, Math.sqrt(Math.max(0, dot(delta, delta) - along * along)));
      depth = Math.max(depth, Math.abs(along));
    }
    if (radius > height * MESH_CLEANUP.tipWidthRatio || depth > height * 0.35) continue;
    const move = Math.min(height * 0.75, MESH_CLEANUP.tipMaxTrim);
    const p = points[id].map((v, a) => Math.fround(v - direction[a] * move)) as Point;
    if (incident[id].every(f => {
      const before = normal(faces[f]), after = normal(faces[f], id, p);
      return dot(before, after) > dot(before, before) * 0.05;
    })) points[id] = p;
  }
  const seen = new Uint8Array(faces.length), output: number[] = [], sources: number[] = [];
  const emit = (a: Point, b: Point, c: Point, source: number) => { output.push(...a, ...b, ...c); sources.push(source); };
  for (let first = 0; first < faces.length; first++) {
    if (seen[first]) continue;
    const group = [first], vertices = new Set<number>(); seen[first] = 1;
    for (let q = 0; q < group.length; q++) for (const v of faces[group[q]]) {
      if (vertices.has(v)) continue;
      vertices.add(v);
      for (const f of incident[v]) if (!seen[f]) { seen[f] = 1; group.push(f); }
    }
    // Removal/refinement requires a whole closed shell clear of chunk borders.
    const closed = [...vertices].every(v => !locked[v]);
    if (!closed) {
      for (const f of group) emit(...faces[f].map(v => points[v]) as [Point, Point, Point], f);
      continue;
    }
    const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
    for (const v of vertices) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], points[v][a]); max[a] = Math.max(max[a], points[v][a]); }
    const span = Math.max(...sub(max, min));
    if (span >= MESH_CLEANUP.fragmentMaxSize && (!refine || span >= MESH_CLEANUP.stoneMaxSize)) {
      for (const f of group) emit(...faces[f].map(v => points[v]) as [Point, Point, Point], f);
      continue;
    }
    let volume = 0, area = 0;
    for (const f of group) {
      const [a, b, c] = faces[f].map(v => sub(points[v], min));
      volume += dot(a, cross(b, c)) / 6;
      area += length(cross(sub(b, a), sub(c, a))) / 2;
    }
    // 3V/A equals sphere radius and approaches zero for sheets/hairs.
    const thickness = 3 * Math.abs(volume) / Math.max(area, 1e-12);
    if (span < MESH_CLEANUP.fragmentMaxSize && (thickness < MESH_CLEANUP.fragmentMinThickness || thickness / span < MESH_CLEANUP.fragmentThinRatio)) continue;
    if (refine && span < MESH_CLEANUP.stoneMaxSize && group.length <= MESH_CLEANUP.stoneMaxFaces && thickness / span > 0.1) {
      // One Loop subdivision, only for compact pebbles. Restore extents so
      // rounding their silhouette does not shrink them or move their bounds.
      const smooth = new Map<number, Point>(), mids = new Map<string, Point>();
      for (const v of vertices) {
        const ns = [...new Set(incident[v].flatMap(f => faces[f]))].filter(n => n !== v);
        const beta = ns.length === 3 ? 3 / 16 : 3 / (8 * ns.length);
        smooth.set(v, points[v].map((x, a) => x * (1 - ns.length * beta) + ns.reduce((s, n) => s + points[n][a], 0) * beta) as Point);
      }
      for (const f of group) for (let j = 0; j < 3; j++) {
        const a = faces[f][j], b = faces[f][(j + 1) % 3], key = edgeKey(a, b);
        if (mids.has(key)) continue;
        const e = edges.get(key)!;
        mids.set(key, points[a].map((x, axis) => (x + points[b][axis]) * 3 / 8 + (points[e.opposite[0]][axis] + points[e.opposite[1]][axis]) / 8) as Point);
      }
      const lo: Point = [Infinity, Infinity, Infinity], hi: Point = [-Infinity, -Infinity, -Infinity];
      for (const p of [...smooth.values(), ...mids.values()]) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
      for (const p of [...smooth.values(), ...mids.values()]) for (let a = 0; a < 3; a++) p[a] = Math.fround(min[a] + (p[a] - lo[a]) * (max[a] - min[a]) / Math.max(hi[a] - lo[a], 1e-12));
      for (const f of group) {
        const [a, b, c] = faces[f], ab = mids.get(edgeKey(a, b))!, bc = mids.get(edgeKey(b, c))!, ca = mids.get(edgeKey(c, a))!;
        emit(smooth.get(a)!, ab, ca, f); emit(ab, smooth.get(b)!, bc, f);
        emit(ca, bc, smooth.get(c)!, f); emit(ab, bc, ca, f);
      }
    } else for (const f of group) emit(...faces[f].map(v => points[v]) as [Point, Point, Point], f);
  }
  return { positions: new Float32Array(output), sources };
}

/** Preserve flat per-face material values through removal and subdivision. */
export function remapFaces<T extends Float32Array | Uint8Array>(values: T, sources: number[], stride: number): T {
  const result = new (values.constructor as { new(length: number): T })(sources.length * stride);
  for (let i = 0; i < sources.length; i++) result.set(values.subarray(sources[i] * stride, (sources[i] + 1) * stride), i * stride);
  return result;
}
