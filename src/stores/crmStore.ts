import { create } from 'zustand';
import { useEmailStore } from './emailStore';
import {
  extractEmailAddress,
  extractName,
  extractDomain,
  parseRecipients,
  shouldSkipContact,
  betterName,
  computeTrajectory,
  type Trajectory,
} from '@/lib/contacts';
import { setDurable } from '@/lib/persistentStore';

/* ------------------------------------------------------------------ */
/* User-owned contact edits (VIP / notes / category)                    */
/*                                                                      */
/* Contacts are re-DERIVED from mail on every session, so user edits    */
/* must live outside the derivation or they evaporate on restart.       */
/* Keyed by email address; applied as the last step of extraction so    */
/* they beat both the heuristics and the AI classifier.                 */
/* ------------------------------------------------------------------ */

const CRM_OVERRIDES_KEY = 'aiden.crm.overrides';

interface ContactOverride {
  category?: Contact['category'];
  notes?: string;
  is_vip?: boolean;
}

function loadCrmOverrides(): Record<string, ContactOverride> {
  try {
    return JSON.parse(localStorage.getItem(CRM_OVERRIDES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCrmOverride(email: string | undefined, patch: ContactOverride): void {
  if (!email) return;
  const key = email.toLowerCase();
  const all = loadCrmOverrides();
  all[key] = { ...all[key], ...patch };
  setDurable(CRM_OVERRIDES_KEY, JSON.stringify(all));
}

function applyCrmOverrides(contacts: Contact[]): Contact[] {
  const overrides = loadCrmOverrides();
  return contacts.map((c) => {
    const o = overrides[c.email_address.toLowerCase()];
    return o ? { ...c, ...o } : c;
  });
}

// Use mock data for development
const USE_MOCK_DATA = false;

export interface Contact {
  id: string;
  email_address: string;
  name?: string;
  domain?: string;
  first_seen: number;
  last_contacted?: number;
  total_emails_received: number;
  total_emails_sent: number;
  total_threads: number;
  relationship_score: number;
  category: 'Colleague' | 'Client' | 'Vendor' | 'Friend' | 'Family' | 'Other';
  is_vip: boolean;
  avg_response_time_minutes?: number;
  last_response_time?: number;
  notes?: string;
  days_since_contact?: number;
  /** Where this relationship is heading relative to its own cadence. */
  trajectory?: Trajectory;
}

export interface EmailInteraction {
  id: string;
  email_id: string;
  contact_id: string;
  direction: 'Incoming' | 'Outgoing';
  timestamp: number;
  response_time_minutes?: number;
  thread_depth?: number;
  was_initiator: boolean;
}

export interface ContactAnalytics {
  contact_id: string;
  email_address: string;
  name?: string;
  total_emails: number;
  emails_sent: number;
  emails_received: number;
  first_contact: number;
  last_contact: number;
  avg_response_time_minutes?: number;
  response_times: number[];
  interaction_frequency: InteractionFrequency[];
  relationship_score: number;
}

export interface InteractionFrequency {
  date: string;
  count: number;
  sent: number;
  received: number;
}

export interface NetworkNode {
  id: string;
  label: string;
  value: number;
  category: string;
  score: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  value: number;
  strength: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

export interface HeatmapData {
  contactId: string;
  contactName: string;
  emailAddress: string;
  data: { day: string; hour: number; count: number }[];
}

export interface CrmState {
  // State
  contacts: Contact[];
  selectedContact: Contact | null;
  analytics: ContactAnalytics | null;
  networkData: NetworkData | null;
  staleContacts: Contact[];
  topContacts: Contact[];
  heatmapData: HeatmapData[];
  isLoading: boolean;
  error: string | null;
  hasExtractedContacts: boolean;

  // Actions
  extractContacts: () => Promise<void>;
  /** Increment a contact's sent count + recency after the user sends them an email. */
  recordSentEmail: (recipient: string, name?: string) => void;
  fetchContacts: (limit?: number, offset?: number) => Promise<void>;
  fetchContact: (contactId: string) => Promise<void>;
  setSelectedContact: (contact: Contact | null) => void;
  updateContactVIP: (contactId: string, isVIP: boolean) => Promise<void>;
  updateContactNotes: (contactId: string, notes: string) => Promise<void>;
  updateContactCategory: (contactId: string, category: Contact['category']) => Promise<void>;
  fetchContactAnalytics: (contactId: string) => Promise<void>;
  fetchNetworkData: (minEmails?: number, limit?: number) => Promise<void>;
  fetchStaleContacts: (daysThreshold?: number) => Promise<void>;
  fetchTopContacts: (limit?: number) => Promise<void>;
  generateHeatmapData: () => Promise<void>;
  refreshAll: () => Promise<void>;
  addManualConnection: (sourceId: string, targetId: string, strength?: number) => void;
  removeManualConnection: (sourceId: string, targetId: string) => void;
}

// AI-classify contacts in background, updating store as results come in
async function classifyContactsInBackground(contacts: Contact[], allEmails: any[]) {
  const { invoke } = await import('@tauri-apps/api/core');

  // Build sample subjects per contact for context
  const subjectsByContact = new Map<string, string[]>();
  for (const email of allEmails) {
    const senderAddr = extractEmailAddress(email.sender);
    if (!subjectsByContact.has(senderAddr)) {
      subjectsByContact.set(senderAddr, []);
    }
    const subjects = subjectsByContact.get(senderAddr)!;
    if (subjects.length < 5 && email.subject) {
      subjects.push(email.subject);
    }
  }

  // Only classify contacts that are still "Other"
  const toClassify = contacts.filter(c => c.category === 'Other');
  if (toClassify.length === 0) return;

  // Batch into groups of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
    const batch = toClassify.slice(i, i + BATCH_SIZE);

    const classifyInputs = batch.map(c => ({
      email_address: c.email_address,
      name: c.name || null,
      domain: c.domain || null,
      emails_received: c.total_emails_received,
      emails_sent: c.total_emails_sent,
      sample_subjects: subjectsByContact.get(c.email_address) || [],
    }));

    try {
      const results = await invoke<{ email_address: string; category: string }[]>(
        'classify_contacts_batch',
        { contacts: classifyInputs }
      );

      // Update contacts in store with classified categories
      const categoryMap = new Map(results.map(r => [r.email_address, r.category]));
      const validCategories = new Set(['Colleague', 'Client', 'Vendor', 'Friend', 'Family', 'Other']);

      useCrmStore.setState((state) => ({
        contacts: state.contacts.map(c => {
          const newCategory = categoryMap.get(c.email_address);
          if (newCategory && validCategories.has(newCategory)) {
            return { ...c, category: newCategory as Contact['category'] };
          }
          return c;
        }),
      }));
    } catch (error) {
      console.error(`[CRM] Failed to classify contacts batch ${i / BATCH_SIZE + 1}:`, error);
      // Continue with next batch even if one fails
    }
  }
}

export const useCrmStore = create<CrmState>((set, get) => ({
  // Initial state
  contacts: [],
  selectedContact: null,
  analytics: null,
  networkData: null,
  staleContacts: [],
  topContacts: [],
  heatmapData: [],
  isLoading: false,
  error: null,
  hasExtractedContacts: false,

  extractContacts: async () => {
    if (USE_MOCK_DATA) {
      set({
        contacts: mockContacts,
        hasExtractedContacts: true,
        isLoading: false
      });
      return;
    }

    try {
      set({ isLoading: true, error: null });

      // Extract contacts directly from in-memory email store
      const emailStore = useEmailStore.getState();
      const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
      const now = Date.now();

      // Mail loads asynchronously (disk cache → Gmail fetch → polling). If we
      // derive against an empty mailbox we must NOT latch `hasExtractedContacts`,
      // or the surface stays stuck on an empty graph forever. Leave the flag as-is
      // (surfaces show "Building…") and wait for the email subscription to re-run
      // this once mail actually arrives.
      if (allEmails.length === 0) {
        set({ isLoading: false });
        return;
      }

      // Preserve AI-classified categories and notes across re-derivation so that
      // re-running extraction (on new mail) neither flickers nor re-classifies
      // contacts we've already resolved — classification only touches "Other".
      const prior = new Map(get().contacts.map((c) => [c.email_address, c]));

      // Get user's own email to skip self
      const { useAuthStore } = await import('./authStore');
      const userEmail = useAuthStore.getState().user?.email?.toLowerCase() || '';

      // Pull the user's VIP sender list from settings so we can auto-flag those contacts.
      let vipSenders = new Set<string>();
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s = await invoke<{ vip_senders?: string[] }>('get_settings');
        vipSenders = new Set((s?.vip_senders || []).map((e) => e.toLowerCase()));
      } catch {
        /* settings unavailable (e.g. web/dev) — fall back to score-based VIP only */
      }

      // Preserve already-resolved categories / manual VIP flags across re-extraction
      // so re-running (as the mailbox loads) doesn't reset AI classifications.
      const priorByEmail = new Map(get().contacts.map((c) => [c.email_address, c]));

      const contactsMap = new Map<string, Contact>();

      for (const email of allEmails) {
        const senderAddr = extractEmailAddress(email.sender);
        const senderName = extractName(email.sender);
        const emailDate = new Date(email.date).getTime();

        // Process sender (incoming emails)
        if (senderAddr && senderAddr !== userEmail && !shouldSkipContact(senderAddr, senderName)) {
          const existing = contactsMap.get(senderAddr);
          if (existing) {
            existing.total_emails_received += 1;
            existing.last_contacted = Math.max(existing.last_contacted || 0, emailDate);
            if (emailDate < existing.first_seen) existing.first_seen = emailDate;
            existing.name = betterName(existing.name, senderName);
          } else {
            contactsMap.set(senderAddr, {
              id: `crm_${senderAddr.replace(/[^a-z0-9]/g, '_')}`,
              email_address: senderAddr,
              name: senderName,
              domain: extractDomain(senderAddr),
              first_seen: emailDate,
              last_contacted: emailDate,
              total_emails_received: 1,
              total_emails_sent: 0,
              total_threads: 0,
              relationship_score: 0,
              category: 'Other',
              is_vip: false,
            });
          }
        }

        // Process recipients (outgoing emails)
        if (email.recipients) {
          // Robustly split the To/Cc value (JSON array or raw header) — handles
          // "Last, First <email>" without spawning a phantom "Last" recipient.
          const recipientList = parseRecipients(email.recipients);

          for (const recipient of recipientList) {
            const recipientAddr = extractEmailAddress(recipient);
            const recipientName = extractName(recipient);

            if (recipientAddr && recipientAddr !== userEmail && !shouldSkipContact(recipientAddr, recipientName)) {
              const existing = contactsMap.get(recipientAddr);
              if (existing) {
                existing.total_emails_sent += 1;
                existing.last_contacted = Math.max(existing.last_contacted || 0, emailDate);
                if (emailDate < existing.first_seen) existing.first_seen = emailDate;
                existing.name = betterName(existing.name, recipientName);
              } else {
                contactsMap.set(recipientAddr, {
                  id: `crm_${recipientAddr.replace(/[^a-z0-9]/g, '_')}`,
                  email_address: recipientAddr,
                  name: recipientName,
                  domain: extractDomain(recipientAddr),
                  first_seen: emailDate,
                  last_contacted: emailDate,
                  total_emails_received: 0,
                  total_emails_sent: 1,
                  total_threads: 0,
                  relationship_score: 0,
                  category: 'Other',
                  is_vip: false,
                });
              }
            }
          }
        }
      }

      // Calculate relationship scores and days since contact
      const contacts: Contact[] = Array.from(contactsMap.values()).map(contact => {
        const totalEmails = contact.total_emails_sent + contact.total_emails_received;
        const daysSince = contact.last_contacted
          ? Math.floor((now - contact.last_contacted) / (1000 * 60 * 60 * 24))
          : undefined;

        // Recency score (40%)
        const recencyScore = contact.last_contacted
          ? Math.min(100, 100 / (1 + (now - contact.last_contacted) / (1000 * 60 * 60 * 24 * 30)))
          : 0;

        // Frequency score (30%)
        const frequencyScore = totalEmails > 0 ? Math.min(100, Math.log10(totalEmails) * 40) : 0;

        // Mutuality score (30%)
        const sent = contact.total_emails_sent;
        const received = contact.total_emails_received;
        const mutualityScore = (sent + received > 0)
          ? (sent > received ? received / sent : sent / received) * 100
          : 0;

        const relationship_score = Math.min(100, recencyScore * 0.4 + frequencyScore * 0.3 + mutualityScore * 0.3);
        const priorContact = prior.get(contact.email_address);
        return {
          ...contact,
          relationship_score,
          days_since_contact: daysSince,
          trajectory: computeTrajectory(
            {
              firstSeen: contact.first_seen,
              lastContacted: contact.last_contacted,
              totalEmails,
            },
            now,
          ),
          // Keep a previously-resolved category — the background classifier only ever
          // touches "Other", so re-extraction must not blow away its work (nor let a
          // stale "Other" overwrite a category the classifier already assigned).
          category:
            priorContact && priorContact.category !== 'Other' ? priorContact.category : contact.category,
          notes: priorContact?.notes ?? contact.notes,
          // Auto-flag VIPs: anyone on the user's VIP-senders list, or a very strong relationship.
          is_vip: vipSenders.has(contact.email_address.toLowerCase()) || relationship_score >= 85,
        };
      });

      // User edits (VIP / notes / category) beat derivation and AI classification.
      const withOverrides = applyCrmOverrides(contacts);

      // Sort by relationship score
      withOverrides.sort((a, b) => b.relationship_score - a.relationship_score);

      // Set contacts immediately so UI renders, then classify in background
      set({ contacts: withOverrides, hasExtractedContacts: true, isLoading: false });

      // AI-classify contacts in background (non-blocking)
      classifyContactsInBackground(contacts, allEmails);
    } catch (error) {
      console.error('Failed to extract contacts:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to extract contacts',
        isLoading: false
      });
    }
  },

  recordSentEmail: (recipient, name) => {
    if (USE_MOCK_DATA) return;
    const addr = extractEmailAddress(recipient);
    if (!addr) return;
    const lower = addr.toLowerCase();
    const now = Date.now();

    // Recompute a contact's relationship score from its counts/recency — same
    // formula as extractContacts, so an incremented sent count stays consistent.
    const scored = (c: Contact): Contact => {
      const total = c.total_emails_sent + c.total_emails_received;
      const recency = c.last_contacted ? Math.min(100, 100 / (1 + (now - c.last_contacted) / (1000 * 60 * 60 * 24 * 30))) : 0;
      const frequency = total > 0 ? Math.min(100, Math.log10(total) * 40) : 0;
      const sent = c.total_emails_sent;
      const received = c.total_emails_received;
      const mutuality = sent + received > 0 ? (sent > received ? received / sent : sent / received) * 100 : 0;
      return {
        ...c,
        relationship_score: Math.min(100, recency * 0.4 + frequency * 0.3 + mutuality * 0.3),
        days_since_contact: c.last_contacted ? Math.floor((now - c.last_contacted) / (1000 * 60 * 60 * 24)) : c.days_since_contact,
      };
    };

    set((state) => {
      let found = false;
      let contacts = state.contacts.map((c) => {
        if (c.email_address.toLowerCase() !== lower) return c;
        found = true;
        return scored({ ...c, total_emails_sent: c.total_emails_sent + 1, last_contacted: now });
      });
      if (!found) {
        // First time we've ever contacted this address — create the contact.
        contacts = [
          ...contacts,
          scored({
            id: `crm_${lower.replace(/[^a-z0-9]/g, '_')}`,
            email_address: addr,
            name: name || extractName(recipient) || undefined,
            domain: extractDomain(addr),
            first_seen: now,
            last_contacted: now,
            total_emails_received: 0,
            total_emails_sent: 1,
            total_threads: 0,
            relationship_score: 0,
            category: 'Other',
            is_vip: false,
          }),
        ];
      }
      contacts.sort((a, b) => b.relationship_score - a.relationship_score);
      return { contacts };
    });
  },

  fetchContacts: async (limit = 100, _offset = 0) => {
    // Contacts are already in memory from extractContacts - just re-extract if empty
    const { contacts, hasExtractedContacts } = get();
    if (!hasExtractedContacts || contacts.length === 0) {
      await get().extractContacts();
    }
  },

  fetchContact: async (contactId: string) => {
    const { contacts } = get();
    const contact = contacts.find(c => c.id === contactId) || null;
    set({ selectedContact: contact });
  },

  setSelectedContact: (contact: Contact | null) => {
    set({ selectedContact: contact });
  },

  updateContactVIP: async (contactId: string, isVIP: boolean) => {
    saveCrmOverride(get().contacts.find((c) => c.id === contactId)?.email_address, { is_vip: isVIP });
    set((state) => ({
      contacts: state.contacts.map(c =>
        c.id === contactId ? { ...c, is_vip: isVIP } : c
      ),
      selectedContact: state.selectedContact?.id === contactId
        ? { ...state.selectedContact, is_vip: isVIP }
        : state.selectedContact
    }));
  },

  updateContactNotes: async (contactId: string, notes: string) => {
    saveCrmOverride(get().contacts.find((c) => c.id === contactId)?.email_address, { notes });
    set((state) => ({
      contacts: state.contacts.map(c =>
        c.id === contactId ? { ...c, notes } : c
      ),
      selectedContact: state.selectedContact?.id === contactId
        ? { ...state.selectedContact, notes }
        : state.selectedContact
    }));
  },

  updateContactCategory: async (contactId: string, category: Contact['category']) => {
    saveCrmOverride(get().contacts.find((c) => c.id === contactId)?.email_address, { category });
    set((state) => ({
      contacts: state.contacts.map(c =>
        c.id === contactId ? { ...c, category } : c
      ),
      selectedContact: state.selectedContact?.id === contactId
        ? { ...state.selectedContact, category }
        : state.selectedContact
    }));
  },

  fetchContactAnalytics: async (contactId: string) => {
    const { contacts } = get();
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Build interaction frequency from emails
    const emailStore = useEmailStore.getState();
    const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
    const contactEmails = allEmails.filter(e => {
      const senderAddr = extractEmailAddress(e.sender);
      return senderAddr === contact.email_address ||
        (e.recipients && e.recipients.toLowerCase().includes(contact.email_address));
    });

    // Group by date for frequency
    const freqMap = new Map<string, { sent: number; received: number }>();
    for (const e of contactEmails) {
      const dateStr = new Date(e.date).toISOString().split('T')[0];
      const existing = freqMap.get(dateStr) || { sent: 0, received: 0 };
      const senderAddr = extractEmailAddress(e.sender);
      if (senderAddr === contact.email_address) {
        existing.received++;
      } else {
        existing.sent++;
      }
      freqMap.set(dateStr, existing);
    }

    const interaction_frequency: InteractionFrequency[] = Array.from(freqMap.entries())
      .map(([date, { sent, received }]) => ({ date, count: sent + received, sent, received }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const analytics: ContactAnalytics = {
      contact_id: contactId,
      email_address: contact.email_address,
      name: contact.name,
      total_emails: contact.total_emails_sent + contact.total_emails_received,
      emails_sent: contact.total_emails_sent,
      emails_received: contact.total_emails_received,
      first_contact: contact.first_seen,
      last_contact: contact.last_contacted || Date.now(),
      avg_response_time_minutes: contact.avg_response_time_minutes,
      response_times: [],
      interaction_frequency,
      relationship_score: contact.relationship_score,
    };

    set({ analytics });
  },

  fetchNetworkData: async (minEmails = 3, limit = 50) => {
    const { contacts } = get();

    // Build nodes from contacts meeting threshold
    const filteredContacts = contacts
      .filter(c => (c.total_emails_sent + c.total_emails_received) >= minEmails)
      .slice(0, limit);

    const nodes: NetworkNode[] = filteredContacts.map(c => ({
      id: c.id,
      label: c.name || c.email_address.split('@')[0],
      value: c.total_emails_sent + c.total_emails_received,
      category: c.category,
      score: c.relationship_score,
    }));

    // Build links from shared threads
    const emailStore = useEmailStore.getState();
    const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
    const contactIds = new Set(filteredContacts.map(c => c.email_address));
    const threadParticipants = new Map<string, Set<string>>();

    for (const email of allEmails) {
      if (!email.thread_id) continue;
      const participants = threadParticipants.get(email.thread_id) || new Set();
      const senderAddr = extractEmailAddress(email.sender);
      if (contactIds.has(senderAddr)) participants.add(senderAddr);
      threadParticipants.set(email.thread_id, participants);
    }

    // Count shared threads between pairs
    const linkMap = new Map<string, number>();
    for (const participants of threadParticipants.values()) {
      const arr = Array.from(participants);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = [arr[i], arr[j]].sort().join('|');
          linkMap.set(key, (linkMap.get(key) || 0) + 1);
        }
      }
    }

    const contactByEmail = new Map(filteredContacts.map(c => [c.email_address, c]));
    const links: NetworkLink[] = Array.from(linkMap.entries())
      .filter(([_, count]) => count >= 2)
      .map(([key, count]) => {
        const [a, b] = key.split('|');
        return {
          source: contactByEmail.get(a)?.id || a,
          target: contactByEmail.get(b)?.id || b,
          value: count,
          strength: Math.log10(count) * 10,
        };
      });

    set({ networkData: { nodes, links } });
  },

  fetchStaleContacts: async (daysThreshold = 30) => {
    const { contacts } = get();
    const stale = contacts.filter(c =>
      c.days_since_contact !== undefined && c.days_since_contact > daysThreshold
    );
    set({ staleContacts: stale });
  },

  fetchTopContacts: async (limit = 10) => {
    const { contacts } = get();
    const top = [...contacts]
      .sort((a, b) => b.relationship_score - a.relationship_score)
      .slice(0, limit);
    set({ topContacts: top });
  },

  generateHeatmapData: async () => {
    // Generate heatmap data showing email frequency by day/hour for each contact
    const { contacts } = get();
    const heatmapData: HeatmapData[] = contacts.slice(0, 20).map(contact => {
      // Generate mock heatmap data
      const data: { day: string; hour: number; count: number }[] = [];
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          // Random but consistent based on contact
          const baseCount = (contact.total_emails_sent + contact.total_emails_received) / 100;
          const count = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * baseCount * 3);
          if (count > 0) {
            data.push({ day: days[day], hour, count });
          }
        }
      }

      return {
        contactId: contact.id,
        contactName: contact.name || contact.email_address.split('@')[0],
        emailAddress: contact.email_address,
        data
      };
    });

    set({ heatmapData });
  },

  refreshAll: async () => {
    const { extractContacts, fetchTopContacts, fetchStaleContacts } = get();
    await extractContacts();
    await fetchTopContacts(10);
    await fetchStaleContacts(30);
  },

  addManualConnection: (sourceId: string, targetId: string, strength: number = 5) => {
    const { networkData } = get();
    if (!networkData) return;

    // Check if both nodes exist
    const sourceExists = networkData.nodes.find(n => n.id === sourceId);
    const targetExists = networkData.nodes.find(n => n.id === targetId);
    if (!sourceExists || !targetExists) return;

    // Check if connection already exists
    const existingLinkIndex = networkData.links.findIndex(
      l => (l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId)
    );

    if (existingLinkIndex >= 0) {
      // Update existing connection
      const existingLink = networkData.links[existingLinkIndex];
      const updatedLinks = [...networkData.links];
      updatedLinks[existingLinkIndex] = {
        ...existingLink,
        value: existingLink.value + 1,
        strength: Math.min(existingLink.strength + strength, 12) // Cap at 12
      };
      set({ networkData: { ...networkData, links: updatedLinks } });
    } else {
      // Add new connection
      const newLink: NetworkLink = {
        source: sourceId,
        target: targetId,
        value: 1,
        strength: strength
      };
      set({ networkData: { ...networkData, links: [...networkData.links, newLink] } });
    }
  },

  removeManualConnection: (sourceId: string, targetId: string) => {
    const { networkData } = get();
    if (!networkData) return;

    const filteredLinks = networkData.links.filter(
      l => !((l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId))
    );

    set({ networkData: { ...networkData, links: filteredLinks } });
  },
}));

// Relationships are a live projection of the mailbox, not a one-shot snapshot.
// Whenever the set of emails changes — initial disk load, the first Gmail fetch,
// or polling picking up new mail — re-derive the contact graph. This is what
// makes the graph appear for a surface that mounted before mail finished loading
// (extractContacts on mount sees an empty store and bails without latching), and
// keeps it current as new people email in. Re-derivation preserves existing
// categories/notes, so it neither flickers nor re-runs AI classification.
if (!USE_MOCK_DATA) {
  let lastEmailCount = -1;
  let deriveTimer: ReturnType<typeof setTimeout> | null = null;
  useEmailStore.subscribe((state) => {
    const count = state.emails.length + state.sentEmails.length;
    if (count === lastEmailCount || count === 0) return;
    lastEmailCount = count;
    // Debounce: a fetch/merge can fire several store updates in quick succession.
    if (deriveTimer) clearTimeout(deriveTimer);
    deriveTimer = setTimeout(() => {
      deriveTimer = null;
      useCrmStore.getState().extractContacts();
    }, 2000);
  });
}

// Mock data for development
const mockContacts: Contact[] = [
  {
    id: 'mock_1',
    email_address: 'sarah.chen@company.com',
    name: 'Sarah Chen',
    domain: 'company.com',
    first_seen: Date.now() - 180 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 1 * 24 * 60 * 60 * 1000,
    total_emails_received: 45,
    total_emails_sent: 42,
    total_threads: 15,
    relationship_score: 92,
    category: 'Colleague',
    is_vip: true,
    avg_response_time_minutes: 45,
    last_response_time: Date.now() - 1 * 24 * 60 * 60 * 1000,
    notes: 'Product lead - key stakeholder',
    days_since_contact: 1
  },
  {
    id: 'mock_2',
    email_address: 'mike.johnson@partner.com',
    name: 'Mike Johnson',
    domain: 'partner.com',
    first_seen: Date.now() - 120 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 3 * 24 * 60 * 60 * 1000,
    total_emails_received: 28,
    total_emails_sent: 25,
    total_threads: 8,
    relationship_score: 78,
    category: 'Client',
    is_vip: true,
    avg_response_time_minutes: 120,
    last_response_time: Date.now() - 3 * 24 * 60 * 60 * 1000,
    notes: 'API integration partner',
    days_since_contact: 3
  },
  {
    id: 'mock_3',
    email_address: 'billing@saas-tool.com',
    name: 'Billing Team',
    domain: 'saas-tool.com',
    first_seen: Date.now() - 90 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 45 * 24 * 60 * 60 * 1000,
    total_emails_received: 12,
    total_emails_sent: 8,
    total_threads: 4,
    relationship_score: 45,
    category: 'Vendor',
    is_vip: false,
    avg_response_time_minutes: 480,
    last_response_time: Date.now() - 45 * 24 * 60 * 60 * 1000,
    days_since_contact: 45
  },
  {
    id: 'mock_4',
    email_address: 'john.doe@company.com',
    name: 'John Doe',
    domain: 'company.com',
    first_seen: Date.now() - 200 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 7 * 24 * 60 * 60 * 1000,
    total_emails_received: 65,
    total_emails_sent: 58,
    total_threads: 22,
    relationship_score: 88,
    category: 'Colleague',
    is_vip: false,
    avg_response_time_minutes: 30,
    last_response_time: Date.now() - 7 * 24 * 60 * 60 * 1000,
    days_since_contact: 7
  },
  {
    id: 'mock_5',
    email_address: 'alex@startup.io',
    name: 'Alex Rivera',
    domain: 'startup.io',
    first_seen: Date.now() - 60 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 14 * 24 * 60 * 60 * 1000,
    total_emails_received: 18,
    total_emails_sent: 12,
    total_threads: 6,
    relationship_score: 65,
    category: 'Client',
    is_vip: false,
    avg_response_time_minutes: 180,
    last_response_time: Date.now() - 14 * 24 * 60 * 60 * 1000,
    days_since_contact: 14
  },
  {
    id: 'mock_6',
    email_address: 'emma.watson@gmail.com',
    name: 'Emma Watson',
    domain: 'gmail.com',
    first_seen: Date.now() - 365 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 60 * 24 * 60 * 60 * 1000,
    total_emails_received: 35,
    total_emails_sent: 28,
    total_threads: 12,
    relationship_score: 55,
    category: 'Friend',
    is_vip: false,
    avg_response_time_minutes: 960,
    last_response_time: Date.now() - 60 * 24 * 60 * 60 * 1000,
    days_since_contact: 60
  },
  {
    id: 'mock_7',
    email_address: 'newsletter@techdigest.com',
    name: 'Tech Digest',
    domain: 'techdigest.com',
    first_seen: Date.now() - 400 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 2 * 24 * 60 * 60 * 1000,
    total_emails_received: 150,
    total_emails_sent: 0,
    total_threads: 0,
    relationship_score: 15,
    category: 'Other',
    is_vip: false,
    avg_response_time_minutes: undefined,
    days_since_contact: 2
  },
  {
    id: 'mock_8',
    email_address: 'david.kim@company.com',
    name: 'David Kim',
    domain: 'company.com',
    first_seen: Date.now() - 150 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 5 * 24 * 60 * 60 * 1000,
    total_emails_received: 52,
    total_emails_sent: 48,
    total_threads: 18,
    relationship_score: 85,
    category: 'Colleague',
    is_vip: false,
    avg_response_time_minutes: 35,
    last_response_time: Date.now() - 5 * 24 * 60 * 60 * 1000,
    days_since_contact: 5
  }
];

function generateMockFrequencyData(): InteractionFrequency[] {
  const data: InteractionFrequency[] = [];
  const now = Date.now();
  for (let i = 89; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const count = Math.random() < 0.8 ? 0 : Math.floor(Math.random() * 5);
    const sent = count > 0 ? Math.floor(Math.random() * count) : 0;
    data.push({
      date: dateStr,
      count,
      sent,
      received: count - sent
    });
  }
  return data;
}

const mockNetworkData: NetworkData = {
  nodes: [
    { id: 'mock_1', label: 'Sarah Chen', value: 87, category: 'Colleague', score: 92 },
    { id: 'mock_2', label: 'Mike Johnson', value: 53, category: 'Client', score: 78 },
    { id: 'mock_3', label: 'Billing Team', value: 20, category: 'Vendor', score: 45 },
    { id: 'mock_4', label: 'John Doe', value: 123, category: 'Colleague', score: 88 },
    { id: 'mock_5', label: 'Alex Rivera', value: 30, category: 'Client', score: 65 },
    { id: 'mock_6', label: 'Emma Watson', value: 63, category: 'Friend', score: 55 },
    { id: 'mock_7', label: 'Tech Digest', value: 150, category: 'Other', score: 15 },
    { id: 'mock_8', label: 'David Kim', value: 100, category: 'Colleague', score: 85 },
  ],
  links: [
    // Sarah Chen connections
    { source: 'mock_1', target: 'mock_4', value: 12, strength: 10.8 },
    { source: 'mock_1', target: 'mock_8', value: 8, strength: 9.0 },
    { source: 'mock_1', target: 'mock_2', value: 3, strength: 4.8 },
    { source: 'mock_1', target: 'mock_6', value: 5, strength: 6.2 },
    { source: 'mock_1', target: 'mock_3', value: 4, strength: 5.5 },
    // John Doe connections
    { source: 'mock_4', target: 'mock_8', value: 15, strength: 11.8 },
    { source: 'mock_4', target: 'mock_6', value: 6, strength: 7.8 },
    { source: 'mock_4', target: 'mock_5', value: 7, strength: 6.8 },
    { source: 'mock_4', target: 'mock_2', value: 4, strength: 5.2 },
    // David Kim connections
    { source: 'mock_8', target: 'mock_3', value: 5, strength: 6.0 },
    { source: 'mock_8', target: 'mock_2', value: 3, strength: 4.5 },
    // Mike Johnson connections
    { source: 'mock_2', target: 'mock_5', value: 5, strength: 7.0 },
    { source: 'mock_2', target: 'mock_3', value: 2, strength: 3.2 },
    // Emma Watson connections
    { source: 'mock_6', target: 'mock_1', value: 3, strength: 4.5 },
  ]
};
