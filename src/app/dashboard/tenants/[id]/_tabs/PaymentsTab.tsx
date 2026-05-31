import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, Badge } from '@/components/ui/Badge';

interface Payment {
  id: string;
  amount: number;
  paid_at: string;
  method: string;
  status: string;
  reference?: string | null;
}

interface Charge {
  id: string;
  amount: number;
  description: string;
  period: string;
  due_date: string;
}

interface Statement {
  total_charges: number;
  total_approved_payments: number;
  balance: number;
  is_overdue: boolean;
}

interface Receipt {
  id: string;
  source: string;
  status: string;
  extracted_amount: number | null;
  confidence: number | null;
  created_at: string;
}

interface PaymentsTabProps {
  payments: Payment[];
  charges: Charge[];
  statement: Statement | null;
  receipts: Receipt[];
}

export function PaymentsTab({ payments, charges, statement, receipts }: PaymentsTabProps) {
  return (
    <div className="p-4 space-y-6">
      {/* Account Statement */}
      {statement && (
        <Card>
          <CardHeader><CardTitle>Account Statement</CardTitle></CardHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Total charged</dt><dd>${statement.total_charges.toLocaleString()}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Total paid</dt><dd className="text-green-600">${statement.total_approved_payments.toLocaleString()}</dd></div>
            <div className="flex justify-between border-t pt-2"><dt className="font-semibold">Balance</dt>
              <dd className={`font-bold ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {statement.balance < 0 ? '-' : ''}${Math.abs(statement.balance).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Payments */}
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-400">No payments</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">${Number(p.amount).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{p.paid_at} · {p.method}</p>
                  {p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}
                </div>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Charges */}
      <Card>
        <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-400">No charges</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {charges.map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{c.description}</p>
                  <p className="text-xs text-slate-500">Period: {c.period} · Due: {c.due_date}</p>
                </div>
                <span className="font-medium">${Number(c.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* WhatsApp Receipts */}
      {receipts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Payment Receipts</CardTitle></CardHeader>
          <div className="divide-y divide-slate-100">
            {receipts.map((r) => (
              <div key={r.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{r.extracted_amount ? `$${Number(r.extracted_amount).toLocaleString()}` : 'Amount unknown'}</p>
                  <p className="text-xs text-slate-500">Source: {r.source} · {new Date(r.created_at).toLocaleDateString()}</p>
                  {r.confidence && <p className="text-xs text-slate-400">Confidence: {(r.confidence * 100).toFixed(0)}%</p>}
                </div>
                <Badge variant={r.status === 'auto_approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'pending'}>
                  {r.status.replace('_', ' ')}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
