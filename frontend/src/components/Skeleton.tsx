import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
    <div className={`animate-pulse rounded bg-slate-200 ${className}`} />
);

export const ClientRowSkeleton = () => (
    <tr className="border-t border-slate-200">
        <td className="px-6 py-5"><Skeleton className="h-6 w-32" /></td>
        <td className="px-6 py-5"><Skeleton className="h-8 w-24" /></td>
        <td className="px-6 py-5"><Skeleton className="h-4 w-24" /></td>
        <td className="px-6 py-5"><Skeleton className="h-4 w-24" /></td>
        <td className="px-6 py-5"><Skeleton className="h-4 w-48" /></td>
        <td className="px-6 py-5 flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
        </td>
    </tr>
);
