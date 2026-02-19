"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PublicDashboard({ params }: { params: { token: string } }) {
    const [status, setStatus] = useState<"online" | "offline">("online");

    useEffect(() => {
        // Heartbeat every 15s
        const interval = setInterval(() => {
            fetch("/api/public/telemetry/heartbeat", {
                method: "POST",
                body: JSON.stringify({ token: params.token, latency: Math.random() * 100 }),
                headers: { "Content-Type": "application/json" }
            }).catch(console.error);
        }, 15000);

        return () => clearInterval(interval);
    }, [params.token]);

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="flex justify-between items-center bg-white p-6 rounded-xl border shadow-sm">
                    <div>
                        <h1 className="text-2xl font-bold">Dashboard do Cliente</h1>
                        <p className="text-sm text-muted-foreground">Monitoramento em tempo real</p>
                    </div>
                    <Badge className={status === "online" ? "bg-emerald-500" : "bg-rose-500"}>
                        {status.toUpperCase()}
                    </Badge>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Mock KPIs */}
                    {[
                        { label: "Total Tasks", value: "124" },
                        { label: "WIP", value: "12" },
                        { label: "Completed (7d)", value: "45" },
                        { label: "Overdue", value: "3" },
                    ].map((kpi) => (
                        <Card key={kpi.label}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">{kpi.label}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{kpi.value}</div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <Card className="h-[400px] flex items-center justify-center text-muted-foreground bg-white border-dashed border-2">
                    Dashboard Content Placeholder (Iframe or Charts)
                </Card>
            </div>
        </div>
    );
}
