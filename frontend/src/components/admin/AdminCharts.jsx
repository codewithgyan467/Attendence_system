import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 1. 7-Day Attendance Trend (Line Chart)
export function AttendanceTrendChart({ trendData = [] }) {
  if (!trendData || trendData.length === 0) {
    return <div className="text-center py-4 text-muted" style={{ fontSize: '13px' }}>No historical trend data available.</div>;
  }

  const labels = trendData.map((d) => d.day || d.date);
  const presentCounts = trendData.map((d) => d.present || 0);
  const absentCounts = trendData.map((d) => d.absent || 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Present Students',
        data: presentCounts,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Absent / Pending',
        data: absentCounts,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 12 } }
      },
      tooltip: {
        backgroundColor: '#0f172a',
        padding: 10,
        titleFont: { size: 13, weight: 'bold' }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: '#f1f5f9' },
        ticks: { stepSize: 1 }
      },
      x: {
        grid: { display: false }
      }
    }
  };

  return (
    <div style={{ height: '260px' }}>
      <Line data={data} options={options} />
    </div>
  );
}

// 2. Attendance Status Breakdown (Doughnut Chart)
export function StatusDistributionChart({ distribution = { present: 0, late: 0, absent: 0 } }) {
  const total = (distribution.present || 0) + (distribution.late || 0) + (distribution.absent || 0);

  if (total === 0) {
    return <div className="text-center py-4 text-muted" style={{ fontSize: '13px' }}>No attendance events recorded today.</div>;
  }

  const data = {
    labels: ['Present', 'Late', 'Absent / Pending'],
    datasets: [
      {
        data: [distribution.present || 0, distribution.late || 0, distribution.absent || 0],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 11 } }
      }
    },
    cutout: '70%'
  };

  return (
    <div style={{ height: '220px' }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}

// 3. Block-Wise Attendance Distribution (Bar Chart)
export function BlockDistributionChart({ blockData = [] }) {
  if (!blockData || blockData.length === 0) {
    return <div className="text-center py-4 text-muted" style={{ fontSize: '13px' }}>No block records available.</div>;
  }

  const labels = blockData.map((b) => b.block || 'Unknown');
  const presentCounts = blockData.map((b) => b.present_today || 0);
  const totalCounts = blockData.map((b) => b.total_students || 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Present Today',
        data: presentCounts,
        backgroundColor: '#4f46e5',
        borderRadius: 6
      },
      {
        label: 'Total Residents',
        data: totalCounts,
        backgroundColor: '#e2e8f0',
        borderRadius: 6
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 11 } }
      }
    },
    scales: {
      y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { stepSize: 1 } },
      x: { grid: { display: false } }
    }
  };

  return (
    <div style={{ height: '240px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}
