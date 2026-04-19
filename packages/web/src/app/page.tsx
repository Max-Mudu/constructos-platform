import { redirect } from 'next/navigation';

// Root path redirects to dashboard; middleware handles auth guard.
export default function Home() {
  redirect('/dashboard');
}
