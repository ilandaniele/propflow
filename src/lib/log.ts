type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  msg: string;
  event?: string;
  [key: string]: unknown;
}

function structuredLog(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  // Never log passwords, session tokens, or service-role keys
  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  // Remove any accidentally-passed sensitive fields
  delete entry.password;
  delete entry.token;
  delete entry.serviceRoleKey;
  delete entry.cookie;

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => structuredLog('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => structuredLog('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => structuredLog('error', msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') structuredLog('debug', msg, fields);
  },

  // Audit-specific helpers
  authSuccess: (userId: string, email: string) =>
    structuredLog('info', 'auth.success', { event: 'auth_success', userId, emailDomain: email.split('@')[1] }),
  authFailure: (email: string, reason: string) =>
    structuredLog('warn', 'auth.failure', { event: 'auth_failure', emailDomain: email?.split('@')[1], reason }),
  accessDenied: (userId: string, path: string, reason: string) =>
    structuredLog('warn', 'access.denied', { event: 'access_denied', userId, path, reason }),
  adminAction: (userId: string, action: string, resourceType: string, resourceId?: string) =>
    structuredLog('info', 'admin.action', { event: 'admin_action', userId, action, resourceType, resourceId }),
  paymentApproved: (adminId: string, paymentId: string, orgId: string) =>
    structuredLog('info', 'payment.approved', { event: 'payment_approved', adminId, paymentId, orgId }),
};
