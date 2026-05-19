import { redirect } from 'next/navigation';
// Public landing — just redirect to sign-in
export default function Welcome() { redirect('/sign-in'); }
