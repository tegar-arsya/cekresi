// app/page.tsx
'use client';

import { useState } from 'react';
import { Package, Search, Loader2, CheckCircle, XCircle, Clock, Copy, Check, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TrackingHistory {
  date: string;
  desc: string;
  location: string;
}

interface TrackingData {
  status: number;
  message: string;
  data: {
    summary: {
      awb: string;
      courier: string;
      service: string;
      status: string;
      date: string;
      desc: string;
      amount: string;
      weight: string;
    };
    detail: {
      origin: string;
      destination: string;
      shipper: string;
      receiver: string;
    };
    history: TrackingHistory[];
  };
}

interface ResiItem {
  resi: string;
  data: TrackingData | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

const API_KEY = process.env.NEXT_PUBLIC_BINDERBYTE_API_KEY;

export default function PosTrackingSystem() {
  const [resiNumbers, setResiNumbers] = useState<string>('');
  const [resiList, setResiList] = useState<ResiItem[]>([]);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [copied, setCopied] = useState<string | null>(null);

  const trackResi = async (resi: string): Promise<TrackingData> => {
    if (!API_KEY) {
      throw new Error('API Key tidak ditemukan');
    }

    const response = await fetch(
      `https://api.binderbyte.com/v1/track?api_key=${API_KEY}&courier=pos&awb=${resi}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 200 && data.status !== 201) {
      throw new Error(data.message || 'Gagal mengambil data tracking');
    }
    
    return data;
  };

  const processResi = async () => {
    if (!resiNumbers.trim()) {
      alert('Silakan masukkan nomor resi');
      return;
    }

    if (!API_KEY) {
      alert('API Key tidak ditemukan. Silakan cek konfigurasi environment variables.');
      return;
    }

    const resiArray = resiNumbers
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0 && r.startsWith('P'));

    if (resiArray.length === 0) {
      alert('Tidak ada nomor resi yang valid');
      return;
    }

    const newResiList: ResiItem[] = resiArray.map(resi => ({
      resi,
      data: null,
      loading: false,
      error: null,
      lastUpdated: null
    }));

    setResiList(newResiList);
    setIsTracking(true);

    for (let i = 0; i < newResiList.length; i++) {
      const resi = newResiList[i].resi;
      
      setResiList(prev => prev.map(item => 
        item.resi === resi ? { ...item, loading: true, error: null } : item
      ));

      try {
        const data = await trackResi(resi);
        
        setResiList(prev => prev.map(item => 
          item.resi === resi ? { 
            ...item, 
            data, 
            loading: false, 
            error: null,
            lastUpdated: new Date().toISOString()
          } : item
        ));
      } catch (error) {
        console.error(`Error tracking ${resi}:`, error);
        setResiList(prev => prev.map(item => 
          item.resi === resi ? { 
            ...item, 
            data: null, 
            loading: false, 
            error: error instanceof Error ? error.message : 'Gagal mengambil data',
            lastUpdated: new Date().toISOString()
          } : item
        ));
      }

      if (i < newResiList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsTracking(false);
  };

  const trackSingleResi = async (resi: string) => {
    if (!API_KEY) {
      alert('API Key tidak ditemukan');
      return;
    }

    setResiList(prev => prev.map(item => 
      item.resi === resi ? { ...item, loading: true, error: null } : item
    ));

    try {
      const data = await trackResi(resi);
      setResiList(prev => prev.map(item => 
        item.resi === resi ? { 
          ...item, 
          data, 
          loading: false, 
          error: null,
          lastUpdated: new Date().toISOString()
        } : item
      ));
    } catch (error) {
      console.error(`Error tracking ${resi}:`, error);
      setResiList(prev => prev.map(item => 
        item.resi === resi ? { 
          ...item, 
          data: null, 
          loading: false, 
          error: error instanceof Error ? error.message : 'Gagal mengambil data',
          lastUpdated: new Date().toISOString()
        } : item
      ));
    }
  };

  const copyResi = (resi: string) => {
    navigator.clipboard.writeText(resi);
    setCopied(resi);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyAllResi = () => {
    const allResi = resiList.map(item => item.resi).join('\n');
    navigator.clipboard.writeText(allResi);
    setCopied('all');
    setTimeout(() => setCopied(null), 2000);
  };

  const exportToExcel = () => {
    const data = resiList.map(item => {
      if (!item.data?.data || item.data.status !== 200) {
        return {
          'No Resi': item.resi,
          'Status': 'ERROR',
          'Layanan': '-',
          'Tanggal': '-',
          'Pengirim': '-',
          'Penerima': '-',
          'Status Terakhir': '-',
          'Pesan Error': item.error || 'Data tidak ditemukan'
        };
      }

      const { summary, detail } = item.data.data;
      const latestHistory = item.data.data.history && item.data.data.history.length > 0 
        ? item.data.data.history[0] 
        : null;

      return {
        'No Resi': item.resi,
        'Status': summary.status,
        'Layanan': summary.service,
        'Tanggal': summary.date,
        'Pengirim': detail.shipper,
        'Penerima': detail.receiver,
        'Status Terakhir': latestHistory ? latestHistory.desc : '-',
        'Pesan Error': ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking POS');
    
    // Auto adjust column widths
    const colWidths = [
      { wch: 15 }, // No Resi
      { wch: 12 }, // Status
      { wch: 10 }, // Layanan
      { wch: 20 }, // Tanggal
      { wch: 20 }, // Pengirim
      { wch: 20 }, // Penerima
      { wch: 40 }, // Status Terakhir
      { wch: 30 }, // Pesan Error
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `tracking-pos-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const clearAll = () => {
    setResiList([]);
    setResiNumbers('');
  };

  const successfulTrackings = resiList.filter(item => item.data?.status === 200).length;
  const failedTrackings = resiList.filter(item => item.data?.status !== 200 || item.error).length;

  // Get latest history (most recent)
  const getLatestHistory = (item: ResiItem) => {
    if (!item.data?.data?.history || item.data.data.history.length === 0) {
      return null;
    }
    return item.data.data.history[0]; // First item is the latest
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-orange-50 to-red-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Package className="w-8 h-8 text-orange-600" />
            <h1 className="text-3xl font-bold text-gray-800">POS Indonesia Bulk Tracker</h1>
          </div>
          <p className="text-gray-600">Tracking multiple paket secara real-time via API BinderByte</p>
          {!API_KEY && (
            <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded">
              <p className="text-red-700 text-sm">
                ⚠️ API Key tidak ditemukan. Silakan set NEXT_PUBLIC_BINDERBYTE_API_KEY di environment variables.
              </p>
            </div>
          )}
        </div>

        {/* Input Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nomor Resi POS Indonesia (pisahkan dengan koma atau enter)
          </label>
          <textarea
            className="w-full px-4 py-3 text-gray-700 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none font-mono"
            rows={6}
            placeholder="Contoh:&#10;P2511100134523&#10;P2511100134524&#10;P2511100134525"
            value={resiNumbers}
            onChange={(e) => setResiNumbers(e.target.value)}
          />
          
          <button
            onClick={processResi}
            disabled={isTracking || !API_KEY}
            className="mt-4 w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {isTracking ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Tracking {resiList.filter(item => item.loading).length}/{resiList.length}...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Track Semua Resi
              </>
            )}
          </button>
        </div>

        {/* Results Section */}
        {resiList.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            {/* Summary */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800">
                  Hasil Tracking ({resiList.length} resi)
                </h2>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    Berhasil: {successfulTrackings}
                  </span>
                  <span className="text-red-600 flex items-center gap-1">
                    <XCircle className="w-4 h-4" />
                    Gagal: {failedTrackings}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={copyAllResi}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors text-sm"
                >
                  {copied === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied === 'all' ? 'Tersalin!' : 'Copy Semua'}
                </button>
                
                <button
                  onClick={exportToExcel}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
                
                <button
                  onClick={clearAll}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 transition-colors text-sm"
                >
                  Hapus Semua
                </button>
              </div>
            </div>

            {/* Resi List */}
            <div className="space-y-4">
              {resiList.map((item, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  {/* Resi Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-lg text-gray-800">
                        {item.resi}
                      </span>
                      <button
                        onClick={() => copyResi(item.resi)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        title="Copy resi"
                      >
                        {copied === item.resi ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-600" />
                        )}
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {item.loading && (
                        <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
                      )}
                      <button
                        onClick={() => trackSingleResi(item.resi)}
                        disabled={item.loading || !API_KEY}
                        className="px-3 py-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white text-sm rounded flex items-center gap-1 transition-colors"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>

                  {/* Tracking Data */}
                  {item.loading && (
                    <div className="text-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin text-orange-600 mx-auto mb-2" />
                      <p className="text-gray-600">Memuat data tracking...</p>
                    </div>
                  )}

                  {item.error && (
                    <div className="bg-red-50 border border-red-200 rounded p-3">
                      <div className="flex items-center gap-2 text-red-800">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{item.error}</span>
                      </div>
                    </div>
                  )}

                  {item.data && item.data.status === 200 && item.data.data && (
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-50 p-3 rounded-lg">
                          <h3 className="font-semibold text-blue-800 mb-2 text-sm">Informasi Pengiriman</h3>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Status:</span>
                              <span className={`font-semibold ${
                                item.data.data.summary.status === 'DELIVERED' 
                                  ? 'text-green-600' 
                                  : 'text-orange-600'
                              }`}>
                                {item.data.data.summary.status}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Layanan:</span>
                              <span className="font-semibold text-black">{item.data.data.summary.service}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Tanggal:</span>
                              <span className="font-semibold text-black">{item.data.data.summary.date}</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-green-50 p-3 rounded-lg">
                          <h3 className="font-semibold text-green-800 mb-2 text-sm">Informasi Penerima & Pengirim</h3>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600 ">Pengirim:</span>
                              <span className="font-semibold text-black">{item.data.data.detail.shipper}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Penerima:</span>
                              <span className="font-semibold text-black">{item.data.data.detail.receiver}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Latest History Only */}
                      {getLatestHistory(item) && (
                        <div className="bg-orange-50 p-3 rounded-lg">
                          <h3 className="font-semibold text-orange-800 mb-2 text-sm flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Status Terbaru
                          </h3>
                          <div className="text-sm">
                            <div className="flex justify-between mb-1">
                              <span className="font-semibold text-black">{getLatestHistory(item)?.date}</span>
                              <span className="text-gray-600">{getLatestHistory(item)?.location}</span>
                            </div>
                            <p className="text-gray-700">{getLatestHistory(item)?.desc}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {item.data && item.data.status !== 200 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                      <div className="flex items-center gap-2 text-yellow-800">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">{item.data.message || 'Data tidak ditemukan'}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How to Use */}
        {resiList.length === 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">Cara Pakai:</h3>
            <ol className="space-y-2 text-gray-700">
              {/* <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">1</span>
                <span>Buat file <code className="bg-gray-100 px-1 rounded">.env.local</code> dan tambah <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_BINDERBYTE_API_KEY=13b4f08fd70c238f99183d65781484692d9229ec88c51c1f344ca19618e44428</code></span>
              </li> */}
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">2</span>
                <span>Masukkan nomor resi POS Indonesia (format: Pxxxxxxxxxxxxx)</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">3</span>
                <span>Klik &quot;Track Semua Resi&quot; untuk mengambil data secara otomatis</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">4</span>
                <span>Data akan ditampilkan lengkap dengan status terbaru dan informasi pengiriman</span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}