import Link from "next/link";
import { buttonVariants } from "./ui/button"
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const supabase = await createClient();

  // You can also use getUser() which will be slower.
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  return user ? (
    <div className="flex items-center gap-4">
      Hey, {user.email}!
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Link
        href="/auth/login"
        className={buttonVariants({
          size: "sm",
          variant: "outline",
        })}
      >
        Sign in
      </Link>

      <Link
        href="/auth/sign-up"
        className={buttonVariants({
          size: "sm",
          variant: "default",
        })}
      >
        Sign up
      </Link>
    </div>
  );
}
