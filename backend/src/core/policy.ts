/** Platform-wide policy values (the initiatives keep their own policy files for their business rules). */
import { config } from '../config.js';

export const platformPolicy = {
  /** Progressive delay per (e-mail, IP) instead of an account lockout. Owner warned every N consecutive failures. */
  loginThrottle: { freeFailures: 3, maxDelaySec: 15 * 60, resetAfterMin: 60, notifyOwnerAfterFailures: 10 },
  /** Profile documents (reusable across initiatives): PDF only, size from MAX_FILE_SIZE_MB. */
  get maxFileSizeMB(): number { return config.maxFileSizeMB; },
  /** E-mail verification and password reset link lifetimes. */
  verifyTokenHours: 24,
  resetTokenHours: 1,
  /** Set-password link for accounts created by an administrator. */
  setupTokenHours: 72,
};
