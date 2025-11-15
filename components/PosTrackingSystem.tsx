// app/page.tsx
'use client';

import { useState } from 'react';
import { Package, Search, Loader2, CheckCircle, XCircle, Clock, Copy, Check, Download, Truck, MapPin, User, Calendar, RefreshCw } from 'lucide-react';
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
        'Penerima': detail.receiver,
        'Status Terakhir': latestHistory ? latestHistory.desc : '-',
        'Pesan Error': ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking POS');
    
    const colWidths = [
      { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 20 },
      { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 30 },
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

  const getLatestHistory = (item: ResiItem) => {
    if (!item.data?.data?.history || item.data.data.history.length === 0) {
      return null;
    }
    return item.data.data.history[0];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl shadow-lg mb-4">
            <Package className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
            POS Indonesia Tracker
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Lacak multiple paket secara real-time dengan integrasi API BinderByte
          </p>
          {!API_KEY && (
            <div className="mt-4 p-4 bg-red-100 border-l-4 border-red-500 rounded-lg max-w-md mx-auto">
              <p className="text-red-700 text-sm font-medium">
                ⚠️ API Key tidak ditemukan. Silakan set NEXT_PUBLIC_BINDERBYTE_API_KEY di environment variables.
              </p>
            </div>
          )}
        </div>

        {/* Input Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Search className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Masukkan Nomor Resi</h2>
              <p className="text-sm text-gray-500">Pisahkan multiple nomor dengan koma atau enter</p>
            </div>
          </div>
          
          <textarea
            className="w-full px-4 py-4 text-gray-700 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all resize-none font-mono text-sm"
            rows={5}
            placeholder="Contoh:&#10;P2511100134523&#10;P2511100134524&#10;P2511100134525"
            value={resiNumbers}
            onChange={(e) => setResiNumbers(e.target.value)}
          />
          
          <div className="flex gap-3 mt-4">
            <button
              onClick={processResi}
              disabled={isTracking || !API_KEY}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
            >
              {isTracking ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Tracking {resiList.filter(item => item.loading).length}/{resiList.length}
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Lacak Semua Paket
                </>
              )}
            </button>
            
            {resiList.length > 0 && (
              <button
                onClick={clearAll}
                className="px-6 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all"
              >
                Hapus Semua
              </button>
            )}
          </div>
        </div>

        {/* Results Section */}
        {resiList.length > 0 && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Total Paket</p>
                    <p className="text-3xl font-bold text-gray-900">{resiList.length}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Package className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Berhasil</p>
                    <p className="text-3xl font-bold text-green-600">{successfulTrackings}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Gagal</p>
                    <p className="text-3xl font-bold text-red-600">{failedTrackings}</p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <XCircle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={copyAllResi}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg"
              >
                {copied === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied === 'all' ? 'Tersalin!' : 'Copy Semua'}
              </button>
              
              <button
                onClick={exportToExcel}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg"
              >
                <Download className="w-4 h-4" />
                Export Excel
              </button>
            </div>

            {/* Tracking Results */}
            <div className="space-y-4">
              {resiList.map((item, index) => (
                <div key={index} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                          <Truck className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-white/80 text-xs font-medium mb-1">Nomor Resi</p>
                          <p className="font-mono font-bold text-lg text-white">{item.resi}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyResi(item.resi)}
                          className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                          title="Copy"
                        >
                          {copied === item.resi ? (
                            <Check className="w-4 h-4 text-white" />
                          ) : (
                            <Copy className="w-4 h-4 text-white" />
                          )}
                        </button>
                        <button
                          onClick={() => trackSingleResi(item.resi)}
                          disabled={item.loading || !API_KEY}
                          className="px-4 py-2 bg-white/20 hover:bg-white/30 disabled:bg-white/10 text-white rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
                        >
                          <RefreshCw className={`w-4 h-4 ${item.loading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    {item.loading && (
                      <div className="text-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-3" />
                        <p className="text-gray-600 font-medium">Memuat data tracking...</p>
                      </div>
                    )}

                    {item.error && (
                      <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-red-900">Error</p>
                            <p className="text-sm text-red-700">{item.error}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {item.data && item.data.status === 200 && item.data.data && (
                      <div className="space-y-6">
                        {/* Status Badge */}
                        <div className="flex items-center gap-3">
                          <div className={`px-4 py-2 rounded-full font-semibold text-sm ${
                            item.data.data.summary.status === 'DELIVERED'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {item.data.data.summary.status}
                          </div>
                          <div className="text-sm text-gray-500 flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {item.data.data.summary.date}
                          </div>
                        </div>

                        {/* Info Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl p-5 border border-blue-200">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                                <Truck className="w-4 h-4 text-white" />
                              </div>
                              <h3 className="font-semibold text-gray-900">Informasi Pengiriman</h3>
                            </div>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Layanan</span>
                                <span className="font-semibold text-gray-900">{item.data.data.summary.service}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Berat</span>
                                <span className="font-semibold text-gray-900">{item.data.data.summary.weight}</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl p-5 border border-purple-200">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                                <User className="w-4 h-4 text-white" />
                              </div>
                              <h3 className="font-semibold text-gray-900">Informasi Pihak</h3>
                            </div>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between items-start">
                                <span className="text-gray-600">Pengirim</span>
                                <span className="font-semibold text-gray-900 text-right">{item.data.data.detail.shipper}</span>
                              </div>
                              <div className="flex justify-between items-start">
                                <span className="text-gray-600">Penerima</span>
                                <span className="font-semibold text-gray-900 text-right">{item.data.data.detail.receiver}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Latest Status Only */}
                        {getLatestHistory(item) && (
                          <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl p-5 border border-orange-200">
                            <div className="flex items-center gap-2 mb-4">
                              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                                <Clock className="w-4 h-4 text-white" />
                              </div>
                              <h3 className="font-semibold text-gray-900">Status Terbaru</h3>
                            </div>
                            <div className="bg-white rounded-lg p-4 shadow-sm border border-orange-200">
                              <div className="flex items-start justify-between mb-2">
                                <p className="font-semibold text-gray-900 text-sm">{getLatestHistory(item)?.date}</p>
                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                  <MapPin className="w-3 h-3" />
                                  {getLatestHistory(item)?.location}
                                </div>
                              </div>
                              <p className="text-sm text-gray-700">{getLatestHistory(item)?.desc}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {item.data && item.data.status !== 200 && (
                      <div className="bg-yellow-50 border-l-4 border-yellow-500 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                          <Clock className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-yellow-900">Data Tidak Ditemukan</p>
                            <p className="text-sm text-yellow-700">{item.data.message}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {resiList.length === 0 && !isTracking && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gray-100 rounded-full mb-6">
              <Package className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Belum ada paket yang dilacak</h3>
            <p className="text-gray-600">Masukkan nomor resi di atas untuk memulai</p>
          </div>
        )}
      </div>
    </div>
  );
}