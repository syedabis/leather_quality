import { redirect } from 'next/navigation';
// Legacy route — redirects to Clerk sign-in
export default function Login() { redirect('/sign-in'); }
