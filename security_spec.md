# ORBIT AI — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **PII Isolation**: User profile documents containing `email` and `displayName` reside exclusively at `/users/{userId}/private/profile` and are readable/writable only by `request.auth.uid == userId` with verified email.
2. **Ownership Integrity**: Every `Conversation`, `Message`, and `TelemetryEntry` must carry `ownerId == request.auth.uid` on creation, and `ownerId` is strictly immutable on update.
3. **Parent-Child Consistency (Master Gate)**: A `Message` in `/conversations/{conversationId}/messages/{messageId}` cannot be created, read, updated, or deleted unless the parent `/conversations/{conversationId}` exists and its `ownerId == request.auth.uid`.
4. **No Query Trust**: All `allow list` rules explicitly validate `resource.data.ownerId == request.auth.uid` without `get()` lookups.
5. **Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on creation and update.
6. **Strict Schema Enforcement**: Every write passes `isValid[Entity]` enforcing `keys().hasAll(...)` and `keys().hasOnly(...)`, type checks, string/number bounds, and regex ID guards (`^[a-zA-Z0-9_\\-]+$`).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)

1. **Unauthenticated Write**: Create `/conversations/conv_1` with `auth == null`.
2. **Unverified Email Write**: Create `/conversations/conv_2` with `auth.token.email_verified == false`.
3. **Cross-User Profile Read**: User B calls `get` on `/users/userA/private/profile`.
4. **Identity Spoofing on Create**: User A creates `/conversations/conv_3` with `ownerId: "userB"`.
5. **Shadow Field Injection**: User A creates `/telemetry/tel_1` with valid fields plus `"isAdmin": true`.
6. **ID Poisoning**: User A attempts to create `/conversations/bad$id..with..slash` or a 300-character ID.
7. **Timestamp Forgery**: User A creates `/conversations/conv_4` with `createdAt` set to a client-chosen past timestamp instead of `request.time`.
8. **Immutable Owner Tampering**: User A updates `/conversations/conv_1` attempting to change `ownerId` to `"userB"`.
9. **Orphaned Message Creation**: User A creates `/conversations/nonexistent/messages/msg_1`.
10. **Cross-Owner Message Injection**: User B creates `/conversations/convOwnedByA/messages/msg_2` even if setting `ownerId: "userB"`.
11. **Oversized Content Exhaustion**: User A creates a `Message` with `content.size() > 32000`.
12. **Blanket List Query**: User A runs `list` on `/conversations` without a `where('ownerId', '==', userA)` filter.
