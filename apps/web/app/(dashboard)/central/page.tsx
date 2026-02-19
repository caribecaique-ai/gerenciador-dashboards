"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Link2, Copy, Search, RefreshCw, MoreVertical, ExternalLink, RotateCcw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export default function CentralPage() {
    const { data: clients, isLoading } = useQuery({
        queryKey: ["clients"],
        queryFn: async () => {
            // API call placeholder
            return [
                { id: "1", name: "Ana Júlia", status: "ACTIVE", workspace: "Equipe 9013271888", lastSync: "17/02/25, 16:54", token: "pk_1118361..." },
                { id: "2", name: "Steve", status: "ACTIVE", workspace: "Equipe 901338378", lastSync: "17/02/25, 16:54", token: "pk_7289902..." },
                { id: "3", name: "Caique", status: "ACTIVE", workspace: "Equipe 9013271888", lastSync: "17/02/25, 16:02", token: "pk_1118417..." },
            ];
        }
    });

    return (
        <div className="space-y-8">
            <header className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Gestão do painel de controle do cliente</h1>
                <div className="flex items-center gap-4">
                    {/* User Profile placeholder */}
                    <div className="flex items-center gap-2 bg-white p-2 rounded-full border shadow-sm">
                        <div className="w-8 h-8 rounded-full bg-blue-500" />
                        <div className="text-sm">
                            <p className="font-semibold">Usuário administrador</p>
                            <p className="text-xs text-muted-foreground">Administrador</p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Action Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-l-4 border-l-emerald-500">
                    <CardHeader>
                        <CardTitle className="text-emerald-700 flex items-center gap-2">
                            <span className="text-xl font-bold">1.</span> Criar novo cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-emerald-500 hover:bg-emerald-600">
                            <Plus className="mr-2 h-4 w-4" /> Adicionar cliente
                        </Button>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-sky-500">
                    <CardHeader>
                        <CardTitle className="text-sky-700 flex items-center gap-2">
                            <span className="text-xl font-bold">2.</span> Conecte-se ao ClickUp
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-sky-500 hover:bg-sky-600">
                            <Link2 className="mr-2 h-4 w-4" /> Autorizar ClickUp
                        </Button>
                        <p className="text-center text-xs text-muted-foreground mt-2">Conexão segura por token</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-purple-500">
                    <CardHeader>
                        <CardTitle className="text-purple-700 flex items-center gap-2">
                            <span className="text-xl font-bold">3.</span> Gerar URL do cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-purple-500 hover:bg-purple-600">
                            <Copy className="mr-2 h-4 w-4" /> Copiar URL do painel
                        </Button>
                        <p className="text-center text-xs text-muted-foreground mt-2">Compartilhar link incorporado</p>
                    </CardContent>
                </Card>
            </div>

            {/* Clients Table */}
            <div className="space-y-4">
                <div className="flex justify-between items-end">
                    <div>
                        <h2 className="text-2xl font-bold">Gerenciar clientes</h2>
                        <p className="text-sm text-muted-foreground">3 conectados de 3 clientes</p>
                        <p className="text-xs text-muted-foreground">Última sincronização: 18/02/25, 02:12 | Sincronização automática 5 min</p>
                    </div>
                    <Button variant="outline" size="sm">
                        <RefreshCw className="mr-2 h-3 w-3" /> Atualizar lista
                    </Button>
                </div>

                <div className="flex gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Buscar clientes..." className="pl-10 h-12" />
                    </div>
                    <div className="flex items-center border rounded-md px-2">
                        <Button variant="ghost" size="sm" disabled>{"<"}</Button>
                        <span className="text-sm px-4">1 / 1</span>
                        <Button variant="ghost" size="sm" disabled>{">"}</Button>
                    </div>
                </div>

                <div className="rounded-md border bg-white shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader className="bg-slate-50">
                            <TableRow>
                                <TableHead>Nome do cliente</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Espaço de trabalho ClickUp</TableHead>
                                <TableHead>Última sincronização</TableHead>
                                <TableHead>URL do painel de controle</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {clients?.map((client) => (
                                <TableRow key={client.id}>
                                    <TableCell className="font-semibold">{client.name}</TableCell>
                                    <TableCell>
                                        <Badge className="bg-emerald-500">Conectado</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{client.workspace}</TableCell>
                                    <TableCell className="text-xs">{client.lastSync}</TableCell>
                                    <TableCell>
                                        <a href="#" className="text-xs text-blue-600 underline truncate block max-w-[200px]">
                                            {`http://localhost:3010/d/${client.token}`}
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button size="sm" className="bg-sky-500 h-8">
                                                <RefreshCw className="h-3 w-3 mr-1" /> Reconectar
                                            </Button>
                                            <Button size="sm" className="bg-purple-500 h-8">
                                                <Copy className="h-3 w-3 mr-1" /> Copiar URL
                                            </Button>
                                            <Button variant="outline" size="sm" className="h-8">
                                                <ExternalLink className="h-3 w-3 mr-1" /> Abrir
                                            </Button>
                                            <Button variant="outline" size="sm" className="h-8 text-rose-500">
                                                Excluir
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
