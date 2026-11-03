"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, getToken } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<Me>("/me")
      .then((me) => router.replace(me.home === "console" ? "/console" : "/play"))
      .catch(() => router.replace("/login"));
  }, [router]);
  return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
}
