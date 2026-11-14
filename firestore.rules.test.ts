import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));

describe('Firestore Security Rules & Blueprint Integrity (Eight Pillars)', () => {
  it('enforces rules_version 2 and default-deny catch-all at top of database block', () => {
    expect(rulesContent).toContain("rules_version = '2';");
    const catchAllIndex = rulesContent.indexOf('match /{document=**}');
    const firstCollectionIndex = rulesContent.indexOf('match /users/{userId}');
    expect(catchAllIndex).toBeGreaterThan(-1);
    expect(catchAllIndex).toBeLessThan(firstCollectionIndex);
    expect(rulesContent).toContain('allow read, write: if false;');
  });

  it('covers every collection defined in firebase-blueprint.json', () => {
    const firestorePaths = Object.keys(blueprint.firestore || {});
    expect(firestorePaths).toContain('/users/{userId}/private/profile');
    expect(firestorePaths).toContain('/conversations/{conversationId}');
    expect(firestorePaths).toContain('/conversations/{conversationId}/messages/{messageId}');
    expect(firestorePaths).toContain('/telemetry/{entryId}');

    expect(rulesContent).toContain('match /users/{userId}/private/profile');
    expect(rulesContent).toContain('match /conversations/{conversationId}');
    expect(rulesContent).toContain('match /messages/{messageId}');
    expect(rulesContent).toContain('match /telemetry/{entryId}');
  });

  it('enforces verified user auth, PII isolation, ID regex, and request.time invariants', () => {
    expect(rulesContent).toContain('request.auth.token.email_verified == true');
    expect(rulesContent).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
    expect(rulesContent).toContain('incoming().createdAt == request.time');
    expect(rulesContent).toContain('incoming().updatedAt == request.time');
    expect(rulesContent).toContain('incoming().ownerId == existing().ownerId');
    expect(rulesContent).toContain('incoming().createdAt == existing().createdAt');
  });

  it('prevents blanket list queries and enforces Master Gate get() on message subcollection', () => {
    expect(rulesContent).not.toMatch(/allow\s+list\s*:\s*if\s+isSignedIn\(\)\s*;/);
    expect(rulesContent).not.toMatch(/allow\s+read\s*:\s*if\s+isSignedIn\(\)\s*;/);
    expect(rulesContent).toContain('allow list: if isVerifiedUser() && resource.data.ownerId == request.auth.uid;');
    expect(rulesContent).toContain(
      'get(/databases/$(database)/documents/conversations/$(conversationId)).data.ownerId == request.auth.uid'
    );
  });

  it('enforces strict hasAll + hasOnly and affectedKeys().hasOnly() against shadow updates', () => {
    expect(rulesContent).toContain('data.keys().hasAll([');
    expect(rulesContent).toContain('data.keys().hasOnly([');
    expect(rulesContent).toContain('incoming().diff(existing()).affectedKeys().hasOnly([');
  });
});
