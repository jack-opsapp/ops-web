// src/lib/api/services/pattern-detection-service.ts
// Discovers business email patterns from the user's inbox and sent mail

import { EmailService } from './email-service';
import type { EmailConnection } from '@/lib/types/email-connection';
import type { EmailProviderInterface, NormalizedEmail } from './email-provider';
import { matchPlatform, isFormSubmissionSubject } from './known-platforms';
import { PUBLIC_EMAIL_DOMAINS } from '@/lib/types/pipeline';

export interface DetectedSource {
  type: 'estimate_pattern' | 'platform' | 'forwarder' | 'ai_detected';
  label: string;
  pattern: string;
  count: number;
  enabled: boolean;
  sampleEmails: Array<{ from: string; subject: string; date: string }>;
}

export interface PatternDetectionResult {
  estimatePattern: string | null;
  estimatePatternConfidence: number;
  estimateThreadCount: number;
  detectedSources: DetectedSource[];
  companyDomains: string[];
  teamForwarders: string[];
  unclassifiedPersonalEmails: NormalizedEmail[];
  /** All personal inbox emails before any filtering — used by the analyze route to send ALL candidates to AI */
  allInboxEmails: NormalizedEmail[];
  /** All sent emails from the analysis period — needed to find outbound recipients for client email detection */
  allSentEmails: NormalizedEmail[];
  /** Map from email ID to its match source, for emails that were pattern-matched */
  emailSourceMap: Record<string, 'estimate_pattern' | 'platform' | 'forwarder'>;
  totalEmailsScanned: number;
}

export const PatternDetectionService = {
  /**
   * Run full pattern detection on a connection's inbox and sent mail.
   * This is the core of wizard Step 2.
   */
  async detect(
    connection: EmailConnection,
    options: { monthsBack?: number } = {}
  ): Promise<PatternDetectionResult> {
    const provider = EmailService.getProvider(connection);
    const monthsBack = options.monthsBack || 3;
    const afterDate = new Date();
    afterDate.setMonth(afterDate.getMonth() - monthsBack);

    // Run all three detection operations in parallel
    const [sentAnalysis, platformDetection, inboxEmails] = await Promise.all([
      PatternDetectionService.analyzeSentMail(provider, afterDate),
      PatternDetectionService.detectPlatforms(provider, afterDate),
      PatternDetectionService.fetchPersonalInbox(provider, afterDate),
    ]);

    // Identify company domains from sent mail (first pass — without forwarders)
    const initialCompanyDomains = PatternDetectionService.identifyCompanyDomains(
      sentAnalysis.allSentEmails,
      connection.email
    );

    // Detect team forwarders (people from company domains who forward form submissions)
    const teamForwarders = PatternDetectionService.detectForwarders(
      inboxEmails,
      initialCompanyDomains
    );

    // Second pass: add forwarder domains to company domains
    const companyDomains = PatternDetectionService.identifyCompanyDomains(
      sentAnalysis.allSentEmails,
      connection.email,
      teamForwarders.map((f) => f.email)
    );

    // Build detected sources list
    const detectedSources: DetectedSource[] = [];

    // Add estimate pattern as a source if found
    if (sentAnalysis.topPattern && sentAnalysis.confidence >= 0.5) {
      detectedSources.push({
        type: 'estimate_pattern',
        label: `Estimate threads matching "${sentAnalysis.topPattern}"`,
        pattern: sentAnalysis.topPattern,
        count: sentAnalysis.threadCount,
        enabled: true,
        sampleEmails: [],
      });
    }

    // Add platform detections
    for (const [platformName, source] of Object.entries(platformDetection.byPlatform)) {
      detectedSources.push({
        type: 'platform',
        label: `${source.category === 'website_form' ? 'Website forms' : source.category === 'bid_platform' ? 'Bid invitations' : 'Leads'} from ${platformName}`,
        pattern: platformName,
        count: source.count,
        enabled: true,
        sampleEmails: source.samples,
      });
    }

    // Add team forwarder detections
    for (const fwd of teamForwarders) {
      detectedSources.push({
        type: 'forwarder',
        label: `Forwarded by ${fwd.name || fwd.email}`,
        pattern: fwd.email,
        count: fwd.count,
        enabled: true,
        sampleEmails: fwd.samples,
      });
    }

    // Collect IDs/threadIds that are already matched and build source map
    const matchedFromEmails = new Set<string>();
    const emailSourceMap: Record<string, 'estimate_pattern' | 'platform' | 'forwarder'> = {};

    const forwarderEmailSet = new Set(teamForwarders.map((f) => f.email.toLowerCase()));
    const alreadyMatchedThreadIds = new Set(sentAnalysis.estimateThreadIds);

    for (const email of inboxEmails) {
      if (matchPlatform(email.from)) {
        matchedFromEmails.add(email.id);
        emailSourceMap[email.id] = 'platform';
      } else if (alreadyMatchedThreadIds.has(email.threadId)) {
        emailSourceMap[email.id] = 'estimate_pattern';
      } else if (forwarderEmailSet.has(email.from.toLowerCase())) {
        emailSourceMap[email.id] = 'forwarder';
      }
    }

    // Filter out non-personal categories for ALL emails (pattern-matched and unclassified)
    const allPersonalInboxEmails = inboxEmails.filter((email) => {
      if (email.labelIds.some((l) => l.startsWith('CATEGORY_') && l !== 'CATEGORY_PERSONAL')) return false;
      return true;
    });

    const unclassifiedPersonalEmails = allPersonalInboxEmails.filter((email) => {
      if (matchedFromEmails.has(email.id)) return false;
      if (alreadyMatchedThreadIds.has(email.threadId)) return false;
      if (forwarderEmailSet.has(email.from.toLowerCase())) return false;
      if (matchPlatform(email.from)) return false;
      return true;
    });

    return {
      estimatePattern: sentAnalysis.topPattern,
      estimatePatternConfidence: sentAnalysis.confidence,
      estimateThreadCount: sentAnalysis.threadCount,
      detectedSources,
      companyDomains,
      teamForwarders: teamForwarders.map((f) => f.email),
      unclassifiedPersonalEmails,
      allInboxEmails: allPersonalInboxEmails,
      allSentEmails: sentAnalysis.allSentEmails,
      emailSourceMap,
      totalEmailsScanned: inboxEmails.length + sentAnalysis.allSentEmails.length,
    };
  },

  /**
   * Analyze sent mail to find the user's outgoing estimate/quote subject pattern
   */
  async analyzeSentMail(
    provider: EmailProviderInterface,
    afterDate: Date
  ): Promise<{
    topPattern: string | null;
    confidence: number;
    threadCount: number;
    estimateThreadIds: string[];
    allSentEmails: NormalizedEmail[];
  }> {
    const sent = await provider.searchEmails('in:sent', { after: afterDate, maxResults: 500 });

    // Group by normalized subject (strip Re:, Fwd:, whitespace)
    const subjectGroups = new Map<string, { count: number; uniqueRecipients: Set<string>; threadIds: string[] }>();

    for (const email of sent) {
      const normalized = PatternDetectionService.normalizeSubject(email.subject);
      if (!normalized || normalized.length < 5) continue;

      if (!subjectGroups.has(normalized)) {
        subjectGroups.set(normalized, { count: 0, uniqueRecipients: new Set(), threadIds: [] });
      }
      const group = subjectGroups.get(normalized)!;
      group.count++;
      email.to.forEach((t) => group.uniqueRecipients.add(t.toLowerCase()));
      if (!group.threadIds.includes(email.threadId)) {
        group.threadIds.push(email.threadId);
      }
    }

    // Find the subject sent to the most UNIQUE external recipients
    let topPattern: string | null = null;
    let topScore = 0;
    let topThreadIds: string[] = [];

    for (const [subject, group] of subjectGroups) {
      if (group.uniqueRecipients.size > topScore) {
        topScore = group.uniqueRecipients.size;
        topPattern = subject;
        topThreadIds = group.threadIds;
      }
    }

    // Confidence: high if the top pattern has significantly more recipients than the runner-up
    const scores = [...subjectGroups.values()].map((g) => g.uniqueRecipients.size).sort((a, b) => b - a);
    const confidence = scores.length >= 2 ? Math.min(1, topScore / (scores[1] + 1)) : topScore > 3 ? 0.9 : 0.5;

    return {
      topPattern,
      confidence,
      threadCount: topThreadIds.length,
      estimateThreadIds: topThreadIds,
      allSentEmails: sent,
    };
  },

  /**
   * Detect known form/bid platform senders in inbox
   */
  async detectPlatforms(
    provider: EmailProviderInterface,
    afterDate: Date
  ): Promise<{
    byPlatform: Record<string, {
      category: string;
      count: number;
      samples: Array<{ from: string; subject: string; date: string }>;
    }>;
  }> {
    const inbox = await provider.searchEmails('in:inbox', { after: afterDate, maxResults: 500 });
    const byPlatform: Record<string, { category: string; count: number; samples: Array<{ from: string; subject: string; date: string }> }> = {};

    for (const email of inbox) {
      const match = matchPlatform(email.from);
      if (match) {
        if (!byPlatform[match.platformName]) {
          byPlatform[match.platformName] = { category: match.category, count: 0, samples: [] };
        }
        byPlatform[match.platformName].count++;
        if (byPlatform[match.platformName].samples.length < 3) {
          byPlatform[match.platformName].samples.push({
            from: email.from,
            subject: email.subject,
            date: email.date.toISOString(),
          });
        }
      }
    }

    return { byPlatform };
  },

  /**
   * Fetch personal inbox emails (CATEGORY_PERSONAL only)
   */
  async fetchPersonalInbox(
    provider: EmailProviderInterface,
    afterDate: Date
  ): Promise<NormalizedEmail[]> {
    return provider.searchEmails('category:primary', { after: afterDate, maxResults: 500 });
  },

  /**
   * Identify company domains from sent mail patterns
   */
  identifyCompanyDomains(
    sentEmails: NormalizedEmail[],
    userEmail: string,
    teamForwarders: string[] = []
  ): string[] {
    const userDomain = userEmail.split('@')[1]?.toLowerCase();
    const domainCounts = new Map<string, number>();

    for (const email of sentEmails) {
      // Check both TO and CC recipients for company domain patterns
      const allRecipients = [...email.to, ...email.cc];
      for (const recipient of allRecipients) {
        const cleaned = recipient.match(/<([^>]+)>/)?.[1] || recipient;
        const domain = cleaned.split('@')[1]?.toLowerCase();
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
        }
      }
    }

    const companyDomains = [...domainCounts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([domain]) => domain);

    // User's own domain (if not a public email provider)
    if (userDomain && !PUBLIC_EMAIL_DOMAINS.has(userDomain) && !companyDomains.includes(userDomain)) {
      companyDomains.push(userDomain);
    }

    // Team forwarder domains are always company domains
    for (const forwarder of teamForwarders) {
      const domain = forwarder.split('@')[1]?.toLowerCase();
      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain) && !companyDomains.includes(domain)) {
        companyDomains.push(domain);
      }
    }

    return companyDomains;
  },

  /**
   * Detect team members who forward form submissions
   */
  detectForwarders(
    inboxEmails: NormalizedEmail[],
    companyDomains: string[]
  ): Array<{ email: string; name: string; count: number; samples: Array<{ from: string; subject: string; date: string }> }> {
    const forwarderMap = new Map<string, { name: string; count: number; samples: Array<{ from: string; subject: string; date: string }> }>();

    for (const email of inboxEmails) {
      const senderDomain = email.from.split('@')[1]?.toLowerCase();
      const isFromCompany = companyDomains.some((d) => senderDomain === d);
      const hasFormSubject = isFormSubmissionSubject(email.subject);

      if (isFromCompany && hasFormSubject) {
        const senderEmail = email.from.toLowerCase();
        if (!forwarderMap.has(senderEmail)) {
          forwarderMap.set(senderEmail, { name: email.fromName, count: 0, samples: [] });
        }
        const fwd = forwarderMap.get(senderEmail)!;
        fwd.count++;
        if (fwd.samples.length < 3) {
          fwd.samples.push({ from: email.from, subject: email.subject, date: email.date.toISOString() });
        }
      }
    }

    return [...forwarderMap.entries()]
      .filter(([, v]) => v.count >= 2)
      .map(([email, v]) => ({ email, ...v }));
  },

  /**
   * Normalize a subject line: strip Re:, Fwd:, and extra whitespace
   */
  normalizeSubject(subject: string): string {
    return subject
      .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
      .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
      .trim();
  },
};
