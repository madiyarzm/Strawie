import React, { useState } from "react";
import { X } from "lucide-react";

export const Footer: React.FC = () => {
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    element.scrollTop = element.scrollHeight;
  };

  return (
    <>
      {/* Footer */}
      <footer
        className="border-t mt-16"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--bg-2)",
          padding: "24px 16px",
        }}
      >
        <div
          className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-center md:justify-between gap-6"
          style={{ color: "var(--text-2)" }}
        >
          <div className="text-sm">
            © 2026 Strawie. Built by Madiyar Zhunussov.
          </div>
          <div className="flex gap-6 text-sm">
            <button
              onClick={() => setShowTerms(true)}
              className="hover:opacity-80 transition-opacity"
              style={{ color: "var(--indigo)" }}
            >
              Terms of Service
            </button>
            <div style={{ color: "var(--border)" }}>•</div>
            <button
              onClick={() => setShowPrivacy(true)}
              className="hover:opacity-80 transition-opacity"
              style={{ color: "var(--indigo)" }}
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>

      {/* Terms Modal */}
      {showTerms && (
        <div
          className="fixed inset-0 flex items-end z-50"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="w-full max-h-[80vh] overflow-y-auto"
            style={{
              backgroundColor: "var(--bg)",
              borderRadius: "20px 20px 0 0",
              borderTop: "1px solid",
              borderColor: "var(--border)",
              padding: "32px 24px",
            }}
            onScroll={handleScroll}
          >
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2
                  className="text-2xl font-bold"
                  style={{ color: "var(--text)" }}
                >
                  Terms of Service
                </h2>
                <button
                  onClick={() => setShowTerms(false)}
                  className="p-2 hover:bg-opacity-80 rounded-lg transition-colors"
                  style={{ backgroundColor: "var(--bg-3)" }}
                >
                  <X size={20} />
                </button>
              </div>

              <div
                className="prose prose-invert max-w-none text-sm space-y-4"
                style={{ color: "var(--text-2)" }}
              >
                <p>
                  <em>Last updated: 08/07/2026</em>
                </p>
                <p>
                  Strawie ("the Service") is a free, non-commercial educational
                  platform for learning Python, operated by Madiyar Zhunussov
                  as an individual, not a registered company or business entity.
                  By using Strawie, you agree to the following terms.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  1. The Service is Free and Provided "As-Is"
                </h3>
                <p>
                  Strawie is provided free of charge, with no guarantee of
                  uptime, availability, or continued operation. It may be
                  modified, suspended, or discontinued at any time without
                  notice.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  2. No Warranty
                </h3>
                <p>
                  The Service is provided "as is" and "as available," without
                  warranties of any kind, express or implied — including but
                  not limited to accuracy, reliability, or fitness for a
                  particular purpose. Code submitted, executed, or generated on
                  the platform (including AI-generated hints) may contain
                  errors.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  3. Limitation of Liability
                </h3>
                <p>
                  To the maximum extent permitted by law, the operator of
                  Strawie is not liable for any indirect, incidental, or
                  consequential damages arising from use of the Service,
                  including but not limited to data loss, service interruption,
                  or reliance on AI-generated content. Your use of the Service
                  is at your own risk.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  4. Acceptable Use
                </h3>
                <p>You agree not to:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>Use the Service for any unlawful purpose</li>
                  <li>Attempt to bypass sandboxing, security, or access controls</li>
                  <li>
                    Upload or submit malicious code intended to harm the
                    platform or other users
                  </li>
                  <li>Harass, impersonate, or interfere with other users</li>
                </ul>
                <p>
                  Violation of these terms may result in suspension or
                  termination of your account at the operator's discretion.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  5. Accounts and Data
                </h3>
                <p>
                  Accounts are created via Google Sign-In. You are responsible
                  for keeping your account secure. Submitted code, classroom
                  activity, and progress data are stored to operate the Service
                  (see Privacy Policy).
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  6. Third-Party Services
                </h3>
                <p>
                  Strawie uses Google (for sign-in) and Anthropic's Claude (for
                  AI-generated coding hints). Your use of the Service means your
                  data may be processed by these third parties as described in
                  the Privacy Policy.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  7. Minors and Parental Involvement
                </h3>
                <p>
                  Strawie is used by students under 18, including students
                  under 13, typically in a classroom or tutoring context
                  arranged through a parent or guardian. If you are a parent or
                  guardian and want to review or request deletion of your
                  child's data, contact madiyar.zmm@gmail.com.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  8. Changes to These Terms
                </h3>
                <p>
                  These terms may be updated at any time. Continued use of the
                  Service after changes constitutes acceptance of the updated
                  terms.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  9. Governing Law
                </h3>
                <p>
                  These terms are governed by the laws of the Republic of
                  Kazakhstan, without regard to conflict of law principles.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  10. Contact
                </h3>
                <p>
                  Questions about these terms:{" "}
                  <a
                    href="mailto:madiyar.zmm@gmail.com"
                    className="underline"
                    style={{ color: "var(--indigo)" }}
                  >
                    madiyar.zmm@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Modal */}
      {showPrivacy && (
        <div
          className="fixed inset-0 flex items-end z-50"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="w-full max-h-[80vh] overflow-y-auto"
            style={{
              backgroundColor: "var(--bg)",
              borderRadius: "20px 20px 0 0",
              borderTop: "1px solid",
              borderColor: "var(--border)",
              padding: "32px 24px",
            }}
            onScroll={handleScroll}
          >
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2
                  className="text-2xl font-bold"
                  style={{ color: "var(--text)" }}
                >
                  Privacy Policy
                </h2>
                <button
                  onClick={() => setShowPrivacy(false)}
                  className="p-2 hover:bg-opacity-80 rounded-lg transition-colors"
                  style={{ backgroundColor: "var(--bg-3)" }}
                >
                  <X size={20} />
                </button>
              </div>

              <div
                className="prose prose-invert max-w-none text-sm space-y-4"
                style={{ color: "var(--text-2)" }}
              >
                <p>
                  <em>Last updated: 08/07/2026</em>
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  What We Collect
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    <strong>Account info</strong>: name and email, via Google
                    Sign-In (OAuth)
                  </li>
                  <li>
                    <strong>Activity data</strong>: code submissions, assignment
                    progress, XP/level data, classroom membership
                  </li>
                  <li>
                    <strong>Technical data</strong>: basic logs (IP address,
                    timestamps) for security and rate-limiting purposes
                  </li>
                </ul>
                <p>
                  We do not collect payment information, and Strawie does not
                  run ads or sell data to third parties.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  How We Use It
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    To operate classrooms, assignments, and progress tracking
                  </li>
                  <li>
                    To generate AI-powered coding hints (submitted code may be
                    sent to Anthropic's Claude API for this purpose)
                  </li>
                  <li>
                    To maintain platform security (e.g., detecting abuse,
                    rate-limiting)
                  </li>
                </ul>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Third Parties
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    <strong>Google</strong> — authentication (Google Sign-In)
                  </li>
                  <li>
                    <strong>Anthropic (Claude)</strong> — AI hint generation
                    from submitted code
                  </li>
                  <li>
                    <strong>Supabase / PostgreSQL</strong> — database hosting
                  </li>
                  <li>
                    <strong>Northflank</strong> — application hosting
                  </li>
                </ul>
                <p>No data is sold or shared for advertising purposes.</p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Children's Privacy
                </h3>
                <p>
                  Strawie is used by students under 18, some of whom are under
                  13. In line with the Republic of Kazakhstan's Law "On
                  Personal Data and Their Protection" and general good practice,
                  we collect only what's needed to operate the platform (name,
                  email, code submissions, progress), and rely on the consent of
                  the parent/guardian who arranges the student's participation.
                  We do not use this data for advertising or share it beyond the
                  third parties listed above. Parents/guardians may contact{" "}
                  <a
                    href="mailto:madiyar.zmm@gmail.com"
                    className="underline"
                    style={{ color: "var(--indigo)" }}
                  >
                    madiyar.zmm@gmail.com
                  </a>{" "}
                  to review, correct, or request deletion of their child's data
                  at any time.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Data Retention
                </h3>
                <p>
                  Data is retained as long as the account is active. You may
                  request account and data deletion at any time by contacting{" "}
                  <a
                    href="mailto:madiyar.zmm@gmail.com"
                    className="underline"
                    style={{ color: "var(--indigo)" }}
                  >
                    madiyar.zmm@gmail.com
                  </a>
                  .
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Security
                </h3>
                <p>
                  We take reasonable measures to protect stored data, including
                  sandboxed code execution and rate-limited endpoints. No system
                  is 100% secure, and Strawie cannot guarantee absolute security
                  of transmitted or stored data.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Changes
                </h3>
                <p>
                  This policy may be updated periodically. Continued use of the
                  Service after changes constitutes acceptance.
                </p>

                <h3
                  className="text-lg font-semibold mt-6"
                  style={{ color: "var(--text)" }}
                >
                  Contact
                </h3>
                <p>
                  <a
                    href="mailto:madiyar.zmm@gmail.com"
                    className="underline"
                    style={{ color: "var(--indigo)" }}
                  >
                    madiyar.zmm@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
