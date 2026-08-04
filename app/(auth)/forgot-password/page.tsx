import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
};

/**
 * Step one of the password reset.
 *
 * No Suspense boundary here, unlike the login page: this form reads no search
 * params, so nothing in it suspends during prerendering.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
