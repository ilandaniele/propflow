/**
 * /dashboard/admin/import — redirect to the first tab (CSV upload)
 */
import { redirect } from 'next/navigation';

export default function AdminImportPage() {
  redirect('/dashboard/admin/import/csv');
}
