import "./globals.css";
import React from "react";
import { Providers } from "@/components/providers";

export const metadata = {
    title: "Dashboard Manager",
    description: "Central de Controle ClickUp",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="pt-BR">
            <body className="bg-slate-50 antialiased">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
