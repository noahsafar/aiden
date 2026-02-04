import React, { useEffect, useState } from 'react';
import { useCrmStore, Contact } from '@/stores/crmStore';
import { Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts';

interface ResponseTimeBucket {
  range: string;
  count: number;
  color: string;
  percentage: number;
}

export const ResponseTimeAnalytics: React.FC = () => {
  const { contacts } = useCrmStore();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // Calculate response time distribution across all contacts
  const calculateResponseTimeStats = () => {
    const responseTimes = contacts
      .filter(c => c.avg_response_time_minutes !== undefined)
      .map(c => c.avg_response_time_minutes!)
      .sort((a, b) => a - b);

    if (responseTimes.length === 0) {
      return {
        average: 0,
        median: 0,
        fastest: 0,
        slowest: 0,
        distribution: [],
      };
    }

    const sum = responseTimes.reduce((a, b) => a + b, 0);
    const average = sum / responseTimes.length;
    const median = responseTimes[Math.floor(responseTimes.length / 2)];
    const fastest = responseTimes[0];
    const slowest = responseTimes[responseTimes.length - 1];

    // Create distribution buckets
    const buckets = [
      { range: '< 15 min', min: 0, max: 15, color: '#10b981' },
      { range: '15-60 min', min: 15, max: 60, color: '#22c55e' },
      { range: '1-4 hours', min: 60, max: 240, color: '#eab308' },
      { range: '4-24 hours', min: 240, max: 1440, color: '#f97316' },
      { range: '> 1 day', min: 1440, max: Infinity, color: '#ef4444' },
    ];

    const distribution: ResponseTimeBucket[] = buckets.map(bucket => {
      const count = responseTimes.filter(
        t => t >= bucket.min && t < bucket.max
      ).length;
      return {
        range: bucket.range,
        count,
        color: bucket.color,
        percentage: (count / responseTimes.length) * 100,
      };
    });

    return {
      average: Math.round(average),
      median: Math.round(median),
      fastest: Math.round(fastest),
      slowest: Math.round(slowest),
      distribution,
    };
  };

  // Get contacts sorted by response time
  const getFastestResponders = () => {
    return contacts
      .filter(c => c.avg_response_time_minutes !== undefined)
      .sort((a, b) => (a.avg_response_time_minutes || 0) - (b.avg_response_time_minutes || 0))
      .slice(0, 10);
  };

  // Get contacts with slowest response times
  const getSlowestResponders = () => {
    return contacts
      .filter(c => c.avg_response_time_minutes !== undefined)
      .sort((a, b) => (b.avg_response_time_minutes || 0) - (a.avg_response_time_minutes || 0))
      .slice(0, 10);
  };

  const stats = calculateResponseTimeStats();
  const fastestResponders = getFastestResponders();
  const slowestResponders = getSlowestResponders();

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
  };

  const getTimeTrend = (minutes: number) => {
    if (minutes < 30) return { icon: TrendingUp, color: 'text-green-500', label: 'Very Fast' };
    if (minutes < 120) return { icon: TrendingUp, color: 'text-green-500', label: 'Fast' };
    if (minutes < 480) return { icon: Minus, color: 'text-yellow-500', label: 'Moderate' };
    if (minutes < 1440) return { icon: TrendingDown, color: 'text-orange-500', label: 'Slow' };
    return { icon: TrendingDown, color: 'text-red-500', label: 'Very Slow' };
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Response Time Analytics</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Analyze your email response patterns and identify communication trends.
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {stats.average > 0 ? formatTime(stats.average) : 'N/A'}
          </div>
          <div className="text-sm text-gray-500">Average Response</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">
            {stats.median > 0 ? formatTime(stats.median) : 'N/A'}
          </div>
          <div className="text-sm text-gray-500">Median Response</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {stats.fastest > 0 ? formatTime(stats.fastest) : 'N/A'}
          </div>
          <div className="text-sm text-gray-500">Fastest Response</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-600">
            {stats.slowest > 0 ? formatTime(stats.slowest) : 'N/A'}
          </div>
          <div className="text-sm text-gray-500">Slowest Response</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Distribution Bar Chart */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Response Time Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.distribution.filter(d => d.count > 0)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="range"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                stroke="#4b5563"
              />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} stroke="#4b5563" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value: number, name: string, props: any) => [
                  `${value} contacts (${props.payload.percentage.toFixed(1)}%)`,
                  name
                ]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {stats.distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Distribution Pie Chart */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Response Time Breakdown</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={stats.distribution.filter(d => d.count > 0)}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.percentage.toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {stats.distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value, entry: any) => (
                  <span style={{ color: '#9ca3af' }}>{entry.payload.range}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Fastest Responders */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Fastest Responders
          </h3>
          <div className="space-y-2">
            {fastestResponders.length > 0 ? fastestResponders.map((contact) => {
              const trend = getTimeTrend(contact.avg_response_time_minutes || 0);
              const TrendIcon = trend.icon;
              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 p-2 bg-white dark:bg-gray-700 rounded-lg"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-br from-green-500 to-emerald-500 flex items-center justify-center text-white text-xs font-bold">
                    {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {contact.name || contact.email_address.split('@')[0]}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{contact.email_address}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-green-600">
                      {formatTime(contact.avg_response_time_minutes || 0)}
                    </div>
                    <TrendIcon className={`h-3 w-3 ${trend.color} mx-auto`} />
                  </div>
                </div>
              );
            }) : (
              <p className="text-sm text-gray-500 text-center py-4">No response time data available</p>
            )}
          </div>
        </div>

        {/* Slowest Responders */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            Slowest Responders
          </h3>
          <div className="space-y-2">
            {slowestResponders.length > 0 ? slowestResponders.map((contact) => {
              const trend = getTimeTrend(contact.avg_response_time_minutes || 0);
              const TrendIcon = trend.icon;
              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 p-2 bg-white dark:bg-gray-700 rounded-lg"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-br from-orange-500 to-red-500 flex items-center justify-center text-white text-xs font-bold">
                    {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {contact.name || contact.email_address.split('@')[0]}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{contact.email_address}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-orange-600">
                      {formatTime(contact.avg_response_time_minutes || 0)}
                    </div>
                    <TrendIcon className={`h-3 w-3 ${trend.color} mx-auto`} />
                  </div>
                </div>
              );
            }) : (
              <p className="text-sm text-gray-500 text-center py-4">No response time data available</p>
            )}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">Insights</h3>
        <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
          {stats.average < 60 && (
            <li>• You respond to emails quickly on average - great for maintaining relationships!</li>
          )}
          {stats.median < stats.average && (
            <li>• Your median response time is faster than your average, indicating some outliers are skewing the data.</li>
          )}
          {stats.distribution[0]?.percentage > 50 && (
            <li>• More than half of your responses happen within 15 minutes - you're very responsive!</li>
          )}
          {stats.distribution[4]?.count > 0 && (
            <li>• Consider setting reminders for contacts you typically respond to after a day.</li>
          )}
        </ul>
      </div>
    </div>
  );
};
