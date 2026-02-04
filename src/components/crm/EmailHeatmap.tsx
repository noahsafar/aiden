import React, { useEffect, useState } from 'react';
import { useCrmStore, Contact, HeatmapData } from '@/stores/crmStore';
import { Clock, User } from 'lucide-react';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hours = Array.from({ length: 24 }, (_, i) => i);

function getHeatmapColor(count: number, maxCount: number): string {
  if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
  const intensity = count / maxCount;
  if (intensity < 0.2) return 'bg-purple-100 dark:bg-purple-900/20';
  if (intensity < 0.4) return 'bg-purple-200 dark:bg-purple-900/30';
  if (intensity < 0.6) return 'bg-purple-300 dark:bg-purple-900/50';
  if (intensity < 0.8) return 'bg-purple-400 dark:bg-purple-800';
  return 'bg-purple-500 dark:bg-purple-700';
}

export const EmailHeatmap: React.FC = () => {
  const { contacts, heatmapData, generateHeatmapData } = useCrmStore();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ day: string; hour: number; count: number } | null>(null);

  useEffect(() => {
    if (heatmapData.length === 0) {
      generateHeatmapData();
    }
  }, []);

  // Find the max count for color scaling
  const maxCount = Math.max(
    ...heatmapData.flatMap(d => d.data.map(c => c.count)),
    1
  );

  const selectedHeatmapData = heatmapData.find(d => d.contactId === selectedContact?.id);
  const currentContact = contacts.find(c => c.id === selectedContact?.id);

  // When "All Contacts" is selected, aggregate data from all contacts
  const getDisplayData = () => {
    if (selectedContact) {
      return selectedHeatmapData?.data || [];
    }
    // Aggregate all contacts
    const aggregatedData: { day: string; hour: number; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        let total = 0;
        heatmapData.forEach(contact => {
          const dataPoint = contact.data.find(
            data => data.day === days[d] && data.hour === h
          );
          total += dataPoint?.count || 0;
        });
        if (total > 0) {
          aggregatedData.push({ day: days[d], hour: h, count: total });
        }
      }
    }
    return aggregatedData;
  };

  const displayData = getDisplayData();

  // Create a 7x24 matrix for the heatmap
  const createHeatmapMatrix = () => {
    const matrix: { day: string; hour: number; count: number }[][] = [];
    for (let d = 0; d < 7; d++) {
      const row: { day: string; hour: number; count: number }[] = [];
      for (let h = 0; h < 24; h++) {
        const dataPoint = displayData.find(
          data => data.day === days[d] && data.hour === h
        );
        row.push({
          day: days[d],
          hour: h,
          count: dataPoint?.count || 0
        });
      }
      matrix.push(row);
    }
    return matrix;
  };

  const heatmapMatrix = createHeatmapMatrix();

  // Calculate hourly distribution based on selected view
  const hourlyDistribution = hours.map(hour => {
    let total = 0;
    if (selectedContact && selectedHeatmapData) {
      // Single contact
      selectedHeatmapData.data.forEach(d => {
        if (d.hour === hour) total += d.count;
      });
    } else {
      // All contacts
      heatmapData.forEach(contact => {
        const dataPoint = contact.data.find(d => d.hour === hour);
        total += dataPoint?.count || 0;
      });
    }
    return { hour, total };
  });

  // Calculate daily distribution based on selected view
  const dailyDistribution = days.map(day => {
    let total = 0;
    if (selectedContact && selectedHeatmapData) {
      // Single contact
      selectedHeatmapData.data.forEach(d => {
        if (d.day === day) total += d.count;
      });
    } else {
      // All contacts
      heatmapData.forEach(contact => {
        const dataPoint = contact.data.find(d => d.day === day);
        total += dataPoint?.count || 0;
      });
    }
    return { day, total };
  });

  const maxHourlyTotal = Math.max(...hourlyDistribution.map(h => h.total), 1);
  const maxDailyTotal = Math.max(...dailyDistribution.map(d => d.total), 1);

  const formatHour = (hour: number) => {
    if (hour === 0) return '12a';
    if (hour < 12) return `${hour}a`;
    if (hour === 12) return '12p';
    return `${hour - 12}p`;
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Email Activity Heatmap</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Visualize when you and your contacts exchange emails throughout the week.
        </p>
      </div>

      {/* Contact Selector */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
          Select Contact
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedContact(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !selectedContact
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            All Contacts
          </button>
          {contacts.slice(0, 10).map(contact => (
            <button
              key={contact.id}
              onClick={() => setSelectedContact(contact)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedContact?.id === contact.id
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {contact.name || contact.email_address.split('@')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Selected Contact Info */}
      {currentContact && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gray-400 flex items-center justify-center text-white font-bold">
            {currentContact.name?.charAt(0).toUpperCase() || currentContact.email_address.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-900 dark:text-white">
              {currentContact.name || currentContact.email_address.split('@')[0]}
            </div>
            <div className="text-sm text-gray-500">{currentContact.email_address}</div>
          </div>
        </div>
      )}

      {/* Heatmap */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-6">

        {/* Heatmap Grid */}
        <div className="flex gap-4">
          {/* Day labels */}
          <div className="flex flex-col gap-1 pt-5">
            {days.map((day, index) => (
              <div key={day} className="h-6 text-xs text-gray-500 flex items-center">
                {day}
              </div>
            ))}
          </div>

          {/* Hour labels */}
          <div className="flex-1">
            <div className="flex justify-around mb-2">
              {hours.filter(h => h % 6 === 0).map(hour => (
                <div key={hour} className="text-xs text-gray-500">
                  {formatHour(hour)}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-rows-7 gap-1">
              {heatmapMatrix.map((row, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-24 gap-1">
                  {row.map((cell, colIndex) => (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className={`h-6 rounded-sm cursor-pointer transition-all hover:ring-2 hover:ring-purple-400 ${getHeatmapColor(cell.count, maxCount)}`}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={`${cell.day} ${formatHour(cell.hour)}: ${cell.count} emails`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-2 mt-4">
          <span className="text-xs text-gray-500">Less</span>
          <div className="flex gap-0.5">
            {['bg-gray-100', 'bg-purple-100', 'bg-purple-200', 'bg-purple-300', 'bg-purple-400', 'bg-purple-500'].map((color, i) => (
              <div key={i} className={`w-4 h-4 rounded-sm ${color}`} />
            ))}
          </div>
          <span className="text-xs text-gray-500">More</span>
        </div>

        {/* Hover Info */}
        {hoveredCell && hoveredCell.count > 0 && (
          <div className="mt-4 p-3 bg-white dark:bg-gray-700 rounded-lg inline-flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {hoveredCell.day} at {formatHour(hoveredCell.hour)}: <strong>{hoveredCell.count} emails</strong>
            </span>
          </div>
        )}
      </div>

      {/* Insights */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        {/* Peak Hours */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Peak Hours</h4>
          <div className="space-y-2">
            {hourlyDistribution
              .sort((a, b) => b.total - a.total)
              .slice(0, 3)
              .map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400 w-12">
                    {formatHour(h.hour)}
                  </span>
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500"
                      style={{ width: `${(h.total / maxHourlyTotal) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{h.total}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Peak Days */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Peak Days</h4>
          <div className="space-y-2">
            {dailyDistribution
              .sort((a, b) => b.total - a.total)
              .map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400 w-12">
                    {d.day}
                  </span>
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500"
                      style={{ width: `${(d.total / maxDailyTotal) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{d.total}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
