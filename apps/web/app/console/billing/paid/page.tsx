"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { formatRupees } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

const FIELDS = ["razorpay_payment_id", "razorpay_payment_link_id", "razorpay_payment_link_reference_id", "razorpay_payment_link_status", "razorpay_signature"] as const;

/** Razorpay sends the browser here after payment; the API checks the signature and records it. */
function PaymentResult() {
  const params = useSearchParams();
  const [result, setResult] = useState<{ paid: boolean; invoice: { number: string; totalPaise: number; status: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const body = Object.fromEntries(FIELDS.map((f) => [f, params.get(f) ?? ""]));
    if (!body.razorpay_payment_link_id) {
      setError("This page opens after a payment on Razorpay.");
      return;
    }
    api<typeof result>("/console/billing/payments/confirm", { body })
      .then(setResult)
      .catch((e) => setError(errorMessage(e)));
  }, [params]);

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 560 }}>
      <h1 style={{ margin: 0 }}>Payment</h1>
      {error ? (
        <ErrorBox message={`${error} If money left your account, it will show as paid once Razorpay confirms it.`} />
      ) : !result ? (
        <Loading label="Confirming your payment" />
      ) : result.paid ? (
        <div className="card stack">
          <span className="pill good" style={{ alignSelf: "flex-start" }}>
            Paid
          </span>
          <div>
            Thank you. Invoice <b>{result.invoice.number}</b> for {formatRupees(result.invoice.totalPaise)} is paid. Razorpay emails your receipt.
          </div>
        </div>
      ) : (
        <div className="card">The payment for invoice {result.invoice.number} has not gone through yet. You can try again from Plan &amp; billing.</div>
      )}
      <Link href="/console/billing" className="btn" style={{ alignSelf: "flex-start" }}>
        Back to Plan &amp; billing
      </Link>
    </div>
  );
}

export default function PaidPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PaymentResult />
    </Suspense>
  );
}
