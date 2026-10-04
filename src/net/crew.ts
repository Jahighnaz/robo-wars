// Crew: devices find each other with a short crew code. A web page cannot scan
// the local Wi-Fi, so PeerJS's free broker introduces the devices; after that
// the data flows over a direct WebRTC channel (inside the same Wi-Fi when possible).
// Star topology: the host relays every message to everyone else.
import type { DataConnection, Peer as PeerT } from 'peerjs';
import { HOST_ONLY, isPublicProfile, type PublicProfile, type RoboMsg } from './robonet';

export type CrewMsg =
  | { k: 'hello'; p: PublicProfile }
  | { k: 'profile'; p: PublicProfile }
  | { k: 'roster'; members: PublicProfile[]; online: string[]; host: string }
  | RoboMsg;

export type CrewStatus = 'off' | 'connecting' | 'online' | 'error';

const PREFIX = 'robo-wars-crew-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newCrewCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}
export const cleanCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Optional own broker for testing or self-hosting: ?broker=host:port (http) or ?broker=https://host */
function brokerOptions(): Record<string, unknown> {
  try {
    const b = new URLSearchParams(location.search).get('broker');
    if (!b) return {};
    const u = new URL(b.includes('://') ? b : 'http://' + b);
    return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), secure: u.protocol === 'https:', path: u.pathname || '/' };
  } catch { return {}; }
}

export class Crew {
  status: CrewStatus = 'off';
  error = '';
  code = '';
  isHost = false;
  hostId = '';
  members = new Map<string, PublicProfile>();
  online = new Set<string>();
  private peer: PeerT | null = null;
  private conns = new Map<string, DataConnection>(); // host: profile id → conn; member: 'host' → conn
  private connOwner = new Map<DataConnection, string>();
  private me: () => PublicProfile;

  /** onMessage receives everything that arrives (already applied to members). onChange fires on any state change. */
  constructor(me: () => PublicProfile, private onMessage: (m: CrewMsg) => void, private onChange: () => void) {
    this.me = me;
  }

  private set(s: CrewStatus, err = '') { this.status = s; this.error = err; this.onChange(); }

  async host(code: string): Promise<void> {
    await this.start(code, true);
  }

  async join(code: string): Promise<void> {
    await this.start(code, false);
  }

  private async start(code: string, asHost: boolean): Promise<void> {
    this.leave();
    this.code = cleanCode(code);
    this.isHost = asHost;
    this.set('connecting');
    let PeerCtor: typeof PeerT;
    try {
      PeerCtor = (await import('peerjs')).Peer;
    } catch {
      this.set('error', 'Could not load the crew module. Are you online?');
      return;
    }
    const me = this.me();
    const opts = { debug: 0, ...brokerOptions() };
    const peer = asHost ? new PeerCtor(PREFIX + this.code, opts) : new PeerCtor(opts);
    this.peer = peer;
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (this.peer !== peer) return;
      const t = e.type || '';
      const msg = t === 'unavailable-id' ? `Crew code ${this.code} is already taken. Pick another or join it instead.`
        : t === 'peer-unavailable' ? `No crew found with code ${this.code}. Check the code, and that the host has the crew screen open.`
        : t === 'network' || t === 'server-error' || t === 'socket-error' ? 'Cannot reach the crew service. Crews need an internet connection to find each other.'
        : 'Crew connection problem: ' + (e.message || t || 'unknown');
      this.set('error', msg);
    });
    peer.on('disconnected', () => { if (this.peer === peer && this.status === 'online') { try { peer.reconnect(); } catch { /* ignore */ } } });
    peer.on('open', () => {
      if (this.peer !== peer) return;
      if (asHost) {
        this.hostId = me.id;
        this.members.set(me.id, me);
        this.online.add(me.id);
        this.set('online');
        peer.on('connection', conn => this.wire(conn));
      } else {
        const conn = peer.connect(PREFIX + this.code, { reliable: true });
        this.wire(conn, 'host');
        conn.on('open', () => { this.send({ k: 'hello', p: this.me() }); });
      }
    });
  }

  private wire(conn: DataConnection, owner?: string) {
    if (owner) { this.conns.set(owner, conn); this.connOwner.set(conn, owner); }
    conn.on('data', raw => this.receive(conn, raw as CrewMsg));
    conn.on('close', () => this.dropConn(conn));
    conn.on('error', () => this.dropConn(conn));
  }

  private dropConn(conn: DataConnection) {
    const owner = this.connOwner.get(conn);
    this.connOwner.delete(conn);
    if (!owner) return;
    this.conns.delete(owner);
    if (this.isHost) {
      this.online.delete(owner);
      this.broadcastRoster();
      this.onChange();
    } else {
      this.set('error', 'Lost the connection to the crew host.');
      this.online.clear();
    }
  }

  private receive(conn: DataConnection, m: CrewMsg) {
    if (!m || typeof m !== 'object' || typeof (m as { k?: unknown }).k !== 'string') return;
    if (this.isHost) {
      if (m.k === 'hello' || m.k === 'profile') {
        if (!isPublicProfile(m.p)) return;
        if (m.k === 'hello') {
          this.conns.set(m.p.id, conn);
          this.connOwner.set(conn, m.p.id);
        }
        this.members.set(m.p.id, m.p);
        this.online.add(m.p.id);
        this.onMessage(m);
        this.broadcastRoster();
        this.onChange();
        return;
      }
      // match inputs are for the host only
      if (HOST_ONLY.has(m.k)) { this.onMessage(m); return; }
      // relay everything else to the other members
      const from = this.connOwner.get(conn);
      this.relay(m, from);
      this.onMessage(m);
      return;
    }
    // member side
    if (m.k === 'roster') {
      this.hostId = m.host;
      this.members.clear();
      for (const p of m.members) if (isPublicProfile(p)) this.members.set(p.id, p);
      this.online = new Set(m.online);
      if (this.status !== 'online') this.set('online'); else this.onChange();
    }
    this.onMessage(m);
  }

  private relay(m: CrewMsg, except?: string) {
    for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(m); } catch { /* ignore */ } }
  }

  private broadcastRoster() {
    this.relay({ k: 'roster', members: [...this.members.values()], online: [...this.online], host: this.hostId });
  }

  /** Send a message to the whole crew (host relays for members). */
  send(m: CrewMsg): void {
    if (this.status !== 'online' && !(m.k === 'hello')) return;
    if (this.isHost) {
      if (m.k === 'profile') { this.members.set(m.p.id, m.p); this.broadcastRoster(); this.onChange(); return; }
      this.relay(m);
    } else {
      const c = this.conns.get('host');
      if (c && c.open) { try { c.send(m); } catch { /* ignore */ } }
    }
  }

  leave(): void {
    const p = this.peer;
    this.peer = null;
    this.conns.clear();
    this.connOwner.clear();
    this.members.clear();
    this.online.clear();
    if (p) { try { p.destroy(); } catch { /* ignore */ } }
    if (this.status !== 'off') this.set('off');
  }
}
