// app/page.tsx
'use client';

import { useMemo, useState } from 'react';
import { Package, Search, Loader2, CheckCircle, XCircle, Copy, Check, Download, FileText, Users } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TrackingHistory {
  date: string;
  desc: string;
  location: string;
}

interface TrackingData {
  status: number;
  message: string;
  retryable?: boolean;
  cached?: boolean;
  attempts?: number;
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
  durationMs: number | null;
  retryable: boolean;
}

interface NormalizedData {
  noResi: string;
  penerimaResi: string;
  penerimaPaket: string;
  statusPenerima: string;
  kategoriPenerima: string;
  lokasi: string;
  tanggal: string;
}

const TRACKING_CONCURRENCY = 5;
const TRACKING_TIMEOUT_MS = 70000;
const FINAL_RETRY_CONCURRENCY = 2;
const FINAL_RETRY_DELAY_MS = 5000;
const TRACKING_CACHE_PREFIX = 'pos-tracking-cache';
const IN_PROCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const DELIVERED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedTrackingData = {
  expiresAt: number;
  data: TrackingData;
};

class TrackingError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'TrackingError';
    this.retryable = retryable;
  }
}

export default function PosTrackingSystem() {
  const [resiNumbers, setResiNumbers] = useState<string>('');
  const [resiList, setResiList] = useState<ResiItem[]>([]);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showNormalization, setShowNormalization] = useState<boolean>(false);

  const getTrackingCacheKey = (resi: string) => `${TRACKING_CACHE_PREFIX}:${resi}`;

  const getTrackingCacheTtl = (data: TrackingData) => {
    if (data.data?.summary?.status?.toUpperCase() === 'DELIVERED') {
      return DELIVERED_CACHE_TTL_MS;
    }

    return IN_PROCESS_CACHE_TTL_MS;
  };

  const readCachedTrackingData = (resi: string) => {
    try {
      const rawCache = window.localStorage.getItem(getTrackingCacheKey(resi));

      if (!rawCache) {
        return null;
      }

      const cached = JSON.parse(rawCache) as CachedTrackingData;

      if (Date.now() > cached.expiresAt) {
        window.localStorage.removeItem(getTrackingCacheKey(resi));
        return null;
      }

      return {
        ...cached.data,
        cached: true,
        retryable: false
      };
    } catch {
      window.localStorage.removeItem(getTrackingCacheKey(resi));
      return null;
    }
  };

  const writeCachedTrackingData = (resi: string, data: TrackingData) => {
    try {
      const cached: CachedTrackingData = {
        expiresAt: Date.now() + getTrackingCacheTtl(data),
        data: {
          ...data,
          cached: false,
          retryable: false
        }
      };

      window.localStorage.setItem(getTrackingCacheKey(resi), JSON.stringify(cached));
    } catch {
      // Ignore cache storage failures so tracking still works in private/limited storage.
    }
  };

  const trackResi = async (resi: string): Promise<TrackingData> => {
    const cached = readCachedTrackingData(resi);

    if (cached) {
      return cached;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), TRACKING_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(
        `/api/track?awb=${encodeURIComponent(resi)}`,
        { signal: controller.signal }
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TrackingError(`Timeout setelah ${TRACKING_TIMEOUT_MS / 1000} detik`, true);
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
    
    if (!response.ok) {
      throw new TrackingError(`HTTP error! status: ${response.status}`, response.status === 429 || response.status >= 500);
    }
    
    const data = await response.json();
    
    if (data.status !== 200 && data.status !== 201) {
      throw new TrackingError(data.message || 'Gagal mengambil data tracking', Boolean(data.retryable));
    }

    writeCachedTrackingData(resi, data);
    
    return data;
  };

  const getErrorMessage = (error: unknown) => (
    error instanceof Error ? error.message : 'Gagal mengambil data'
  );

  // Fungsi untuk mengekstrak informasi penerima paket dari status terakhir
  const extractReceiverInfo = (historyDesc: string) => {
    if (!historyDesc) return { penerimaPaket: '', statusPenerima: '', kategoriPenerima: '' };

    // Pattern matching untuk mengekstrak nama penerima dan status
    const penerimaMatch = historyDesc.match(/diterima oleh\s*\(([^)]+)\)/i);
    const statusMatch = historyDesc.match(/\(([^)]+)\)\s*$/i);

    const penerimaPaket = penerimaMatch ? penerimaMatch[1].trim() : '';
    const statusPenerima = statusMatch ? statusMatch[1].trim() : '';

    // Kategorikan status penerima
    let kategoriPenerima = 'Tidak Diketahui';
    if (statusPenerima.includes('DITERIMA YANG BERSANGKUTAN')) {
      kategoriPenerima = 'Penerima Langsung';
    } else if (statusPenerima.includes('DITERIMA ORANG SERUMAH')) {
      kategoriPenerima = 'Keluarga/Serumah';
    } else if (statusPenerima.includes('Keluarga')) {
      kategoriPenerima = 'Keluarga';
    } else if (statusPenerima.includes('tetangga') || statusPenerima.includes('sekitar')) {
      kategoriPenerima = 'Tetangga/Sekitar';
    } else if (statusPenerima.includes('rekan kerja')) {
      kategoriPenerima = 'Rekan Kerja';
    }

    return { penerimaPaket, statusPenerima, kategoriPenerima };
  };

  // Fungsi untuk mengekstrak lokasi dari deskripsi
  const extractLocation = (historyDesc: string) => {
    if (!historyDesc) return '';
    
    // Ambil bagian sebelum "Delivered |" atau "On Delivery |"
    const locationMatch = historyDesc.match(/^([^|]+)/);
    return locationMatch ? locationMatch[1].trim() : '';
  };

  // Generate data ternormalisasi
  const generateNormalizedData = (): NormalizedData[] => {
    return resiList.map(item => {
      if (!item.data?.data || item.data.status !== 200) {
        return {
          noResi: item.resi,
          penerimaResi: '-',
          penerimaPaket: '-',
          statusPenerima: '-',
          kategoriPenerima: 'Error',
          lokasi: '-',
          tanggal: '-'
        };
      }

      const { summary, detail } = item.data.data;
      const latestHistory = item.data.data.history && item.data.data.history.length > 0 
        ? item.data.data.history[0] 
        : null;

      const { penerimaPaket, statusPenerima, kategoriPenerima } = latestHistory 
        ? extractReceiverInfo(latestHistory.desc)
        : { penerimaPaket: '', statusPenerima: '', kategoriPenerima: 'Tidak Diketahui' };

      const lokasi = latestHistory ? extractLocation(latestHistory.desc) : '';

      return {
        noResi: item.resi,
        penerimaResi: detail.receiver,
        penerimaPaket: penerimaPaket || detail.receiver, // Fallback ke penerima resi jika tidak ada data
        statusPenerima: statusPenerima || summary.status,
        kategoriPenerima: kategoriPenerima,
        lokasi: lokasi,
        tanggal: latestHistory?.date || summary.date
      };
    });
  };

  const processResi = async () => {
    if (!resiNumbers.trim()) {
      alert('Silakan masukkan nomor resi');
      return;
    }

    const resiArray = Array.from(new Set(resiNumbers
      .split(/[\n,]+/)
      .map(r => r.trim().toUpperCase())
      .filter(r => r.length > 0 && r.startsWith('P'))));

    if (resiArray.length === 0) {
      alert('Tidak ada nomor resi yang valid');
      return;
    }

    const newResiList: ResiItem[] = resiArray.map(resi => ({
      resi,
      data: null,
      loading: true,
      error: null,
      lastUpdated: null,
      durationMs: null,
      retryable: false
    }));

    setResiList(newResiList);
    setIsTracking(true);
    setShowNormalization(false); // Reset normalization view

    try {
      const retryIndexes: number[] = [];

      const updateResult = (index: number, updates: Partial<Omit<ResiItem, 'resi'>>) => {
        setResiList(prev => prev.map((item, itemIndex) => (
          itemIndex === index ? { ...item, ...updates } : item
        )));
      };

      const processIndexes = async (indexes: number[], concurrency: number, retrying = false) => {
        let nextIndex = 0;
        const workerCount = Math.min(concurrency, indexes.length);

        const worker = async () => {
          while (nextIndex < indexes.length) {
            const currentIndex = indexes[nextIndex];
            nextIndex += 1;

            const resi = resiArray[currentIndex];
            updateResult(currentIndex, {
              loading: true,
              error: null,
              retryable: false
            });

            const startedAt = performance.now();

            try {
              const data = await trackResi(resi);
              const durationMs = Math.round(performance.now() - startedAt);
              console.info(`Tracking ${resi} selesai dalam ${durationMs}ms`);
              updateResult(currentIndex, {
                data,
                loading: false,
                error: null,
                lastUpdated: new Date().toISOString(),
                durationMs,
                retryable: false
              });
            } catch (error) {
              const durationMs = Math.round(performance.now() - startedAt);
              const retryable = error instanceof TrackingError && error.retryable;
              console.warn(`Tracking ${resi} gagal dalam ${durationMs}ms: ${getErrorMessage(error)}`);

              if (retryable && !retrying) {
                retryIndexes.push(currentIndex);
              }

              updateResult(currentIndex, {
                data: null,
                loading: false,
                error: getErrorMessage(error),
                lastUpdated: new Date().toISOString(),
                durationMs,
                retryable
              });
            }
          }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
      };

      await processIndexes(
        resiArray.map((_, index) => index),
        TRACKING_CONCURRENCY
      );

      if (retryIndexes.length > 0) {
        await new Promise(resolve => window.setTimeout(resolve, FINAL_RETRY_DELAY_MS));
        await processIndexes(retryIndexes, FINAL_RETRY_CONCURRENCY, true);
      }
    } catch (error) {
      console.error('Error tracking batch:', error);
    } finally {
      setIsTracking(false);
    }
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
          'Pesan Error': item.error || 'Data tidak ditemukan',
          'Waktu Respons': item.durationMs ? `${(item.durationMs / 1000).toFixed(2)} detik` : '-'
        };
      }

      const { detail } = item.data.data;
      const latestHistory = item.data.data.history && item.data.data.history.length > 0 
        ? item.data.data.history[0] 
        : null;

      return {
        'No Resi': item.resi,
        'Penerima': detail.receiver,
        'Status Terakhir': latestHistory ? latestHistory.desc : '-',
        'Pesan Error': '',
        'Waktu Respons': item.durationMs ? `${(item.durationMs / 1000).toFixed(2)} detik` : '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking POS');
    
    const colWidths = [
      { wch: 15 }, { wch: 25 }, { wch: 60 }, { wch: 30 }, { wch: 18 },
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `tracking-pos-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportNormalizedToExcel = () => {
    const normalizedData = generateNormalizedData();
    const data = normalizedData.map(item => ({
      'No Resi': item.noResi,
      'Penerima Resi': item.penerimaResi,
      'Penerima Paket': item.penerimaPaket,
      'Status Penerima': item.statusPenerima,
      'Kategori Penerima': item.kategoriPenerima,
      'Lokasi': item.lokasi,
      'Tanggal': item.tanggal
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Ternormalisasi');
    
    const colWidths = [
      { wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 30 },
      { wch: 20 }, { wch: 25 }, { wch: 20 }
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `data-normalisasi-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const clearAll = () => {
    setResiList([]);
    setResiNumbers('');
    setShowNormalization(false);
  };

  const successfulTrackings = useMemo(
    () => resiList.filter(item => item.data?.status === 200).length,
    [resiList]
  );
  const failedTrackings = useMemo(
    () => resiList.filter(item => !item.loading && (item.data?.status !== 200 || item.error)).length,
    [resiList]
  );
  const pendingTrackings = useMemo(
    () => resiList.filter(item => item.loading).length,
    [resiList]
  );
  const averageDurationMs = useMemo(() => {
    const completedDurations = resiList
      .map(item => item.durationMs)
      .filter((duration): duration is number => typeof duration === 'number');

    if (completedDurations.length === 0) {
      return null;
    }

    return Math.round(
      completedDurations.reduce((total, duration) => total + duration, 0) / completedDurations.length
    );
  }, [resiList]);

  const normalizedData = generateNormalizedData();

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
              disabled={isTracking}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
            >
              {isTracking ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Tracking {resiList.length - pendingTrackings}/{resiList.length}
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Ternormalisasi</p>
                    <p className="text-3xl font-bold text-purple-600">{normalizedData.filter(item => item.kategoriPenerima !== 'Error').length}</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Users className="w-6 h-6 text-purple-600" />
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
                Export Excel Tracking
              </button>

              <button
                onClick={() => setShowNormalization(!showNormalization)}
                className={`px-6 py-3 rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg ${
                  showNormalization 
                    ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                    : 'bg-gray-600 hover:bg-gray-700 text-white'
                }`}
              >
                <FileText className="w-4 h-4" />
                {showNormalization ? 'Tampilkan Tracking' : 'Tampilkan Normalisasi'}
              </button>

              {showNormalization && (
                <button
                  onClick={exportNormalizedToExcel}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  Export Data Normalisasi
                </button>
              )}
            </div>

            {/* Normalized Data View */}
            {showNormalization ? (
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Data Ternormalisasi</h2>
                      <p className="text-white/80 text-sm">Informasi penerima paket yang sudah dinormalisasi</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">No Resi</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Penerima Resi</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Penerima Paket</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status Penerima</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kategori</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lokasi</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {normalizedData.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                            {item.noResi}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.penerimaResi}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {item.penerimaPaket}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            <div className="max-w-xs truncate" title={item.statusPenerima}>
                              {item.statusPenerima}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              item.kategoriPenerima === 'Penerima Langsung' ? 'bg-green-100 text-green-800' :
                              item.kategoriPenerima === 'Keluarga/Serumah' ? 'bg-blue-100 text-blue-800' :
                              item.kategoriPenerima === 'Keluarga' ? 'bg-blue-100 text-blue-800' :
                              item.kategoriPenerima === 'Tetangga/Sekitar' ? 'bg-yellow-100 text-yellow-800' :
                              item.kategoriPenerima === 'Rekan Kerja' ? 'bg-purple-100 text-purple-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {item.kategoriPenerima}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {item.lokasi}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Detail kartu disembunyikan</h2>
                    <p className="text-sm text-gray-600">
                      Untuk menjaga tampilan tetap ringan, detail per-resi tidak dirender. Data tetap tersimpan untuk export Excel dan normalisasi.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                    <span className="rounded-full bg-gray-100 px-3 py-2">Total {resiList.length}</span>
                    <span className="rounded-full bg-blue-50 px-3 py-2 text-blue-700">Proses {pendingTrackings}</span>
                    <span className="rounded-full bg-green-50 px-3 py-2 text-green-700">Berhasil {successfulTrackings}</span>
                    <span className="rounded-full bg-red-50 px-3 py-2 text-red-700">Gagal {failedTrackings}</span>
                    <span className="rounded-full bg-purple-50 px-3 py-2 text-purple-700">
                      Rata-rata {averageDurationMs ? `${(averageDurationMs / 1000).toFixed(2)} detik` : '-'}
                    </span>
                  </div>
                </div>
              </div>
            )}
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
