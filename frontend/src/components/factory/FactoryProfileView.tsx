import React, { useState, useEffect } from 'react';
import { FactoryProfile } from '../../types';
import { usePlatformStore } from '../../store/state';
import { Badge } from '../ui/Badge';
import { api } from '../../api';
import {
  Building2,
  Factory,
  FileText,
  MapPin,
  Zap,
  Users,
  ShieldCheck,
  Save,
  CheckCircle2,
  Upload,
  Trash2,
  ExternalLink
} from 'lucide-react';

interface FactoryProfileViewProps {
  factory: FactoryProfile;
}

export const FactoryProfileView: React.FC<FactoryProfileViewProps> = ({ factory }) => {
  const { language } = usePlatformStore();
  const isAr = language === 'ar';

  const [formData, setFormData] = useState<FactoryProfile>(factory);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [detailsDesc, setDetailsDesc] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // مزامنة النموذج عند تبديل المصنع + قراءة ملفات التفاصيل الحية من الـ API
  useEffect(() => {
    setFormData(factory);
  }, [factory.id]);

  const [detailsFiles, setDetailsFiles] = useState<Array<Record<string, any>>>([]);
  const refreshFiles = async (fid: string) => {
    try {
      const r = await api.listDetailsFiles(fid);
      setDetailsFiles(r.data ?? []);
    } catch { setDetailsFiles([]); }
  };
  useEffect(() => {
    void refreshFiles(factory.id);
  }, [factory.id]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDetailsUpload = async () => {
    if (!pendingFile) return;
    // ملف التفاصيل = PDF للمستندات الإضافية — التحقق النهائي في الباك + تحقق شكلي هنا
    const isPdf = pendingFile.type.includes('pdf') || pendingFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      alert(isAr ? 'ملف التفاصيل يجب أن يكون PDF فقط.' : 'Details file must be PDF only.');
      return;
    }
    if (pendingFile.size > 15 * 1024 * 1024) {
      alert(isAr ? 'تجاوز الحجم الأقصى (15 MB).' : 'File exceeds max size (15 MB).');
      return;
    }
    try {
      await api.uploadDetailsFile(factory.id, pendingFile, {
        description: detailsDesc || (isAr ? 'ملف تفاصيل المصنع' : 'Factory details file'),
      });
      setPendingFile(null);
      setDetailsDesc('');
      void refreshFiles(factory.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : (isAr ? 'تعذر رفع الملف.' : 'Upload failed.'));
    }
  };

  const handleChange = (field: keyof FactoryProfile, val: any) => {
    setFormData(prev => ({ ...prev, [field]: val }));
    setSavedSuccess(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateFactory(factory.id, {
        nameAr: formData.nameAr,
        nameEn: formData.nameEn,
        commercialRegistrationNumber: formData.commercialRegistrationNumber,
        industrialRegistrationNumber: formData.industrialRegistrationNumber,
        taxIdNumber: formData.taxIdNumber,
        sector: formData.sector,
        sectorEn: formData.sectorEn,
        governorate: formData.governorate,
        governorateEn: formData.governorateEn,
        industrialZone: formData.industrialZone,
        roofAreaSqMeters: formData.roofAreaSqMeters,
        annualEnergyConsumptionMWh: formData.annualEnergyConsumptionMWh,
        monthlyElectricityBillEGP: formData.monthlyElectricityBillEGP,
        employeesCount: formData.employeesCount,
        contactPerson: formData.contactPerson,
        contactPhone: formData.contactPhone,
        contactEmail: formData.contactEmail,
        facilityAddressDetailed: formData.facilityAddressDetailed,
        secondaryPhone: formData.secondaryPhone,
        website: formData.website,
        contactJobTitle: formData.contactJobTitle,
        contactFax: formData.contactFax,
        contactMobile: formData.contactMobile,
        mainProducts: formData.mainProducts,
        mainProcesses: formData.mainProcesses,
        electricitySourceType: formData.electricitySourceType ?? undefined,
        electricitySourceOther: formData.electricitySourceOther,
        annualElectricityKwh: formData.annualElectricityKwh,
        operatingHoursPerDay: formData.operatingHoursPerDay,
        operatingDaysPerWeek: formData.operatingDaysPerWeek,
        electricityCostEGP: formData.electricityCostEGP,
        concreteRoofM2: formData.concreteRoofM2,
        metalRoofM2: formData.metalRoofM2,
        vacantLandM2: formData.vacantLandM2,
        hasEnergyReductionProcedures: formData.hasEnergyReductionProcedures,
        hasEfficiencyStudies: formData.hasEfficiencyStudies,
        hasEnergyDept: formData.hasEnergyDept,
        energyNotes: formData.energyNotes,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : (isAr ? 'تعذر حفظ الملف الموحد.' : 'Save failed.'));
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            {isAr ? 'الملف الموحد للمنشأة الصناعية (Central Factory Profile)' : 'Central Factory Profile'}
          </h2>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>
            {isAr 
              ? 'يتم تسجيل وتوثيق بيانات المنشأة مرة واحدة وإعادة استخدامها في كافة المبادرات دون تكرار الإدخال.'
              : 'Factory data registered once and securely reused across all initiatives.'}
          </p>
        </div>

        {savedSuccess && (
          <Badge tone="approved">
            <CheckCircle2 size={16} />
            {isAr ? 'تم حفظ التعديلات بنجاح' : 'Changes Saved Successfully'}
          </Badge>
        )}
      </div>

      <form onSubmit={handleSave}>
        {/* Section 1: Official & Legal Data */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Building2 size={18} style={{ color: 'var(--gov-primary-700)' }} />
            <span>{isAr ? '1. البيانات الأساسية والقانونية' : '1. Legal & Identity Information'}</span>
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label required">{isAr ? 'اسم المنشأة الصناعية (بالعربية)' : 'Factory Name (Arabic)'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.nameAr}
                onChange={e => handleChange('nameAr', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'اسم المنشأة الصناعية (بالإنجليزية)' : 'Factory Name (English)'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.nameEn}
                onChange={e => handleChange('nameEn', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'رقم السجل التجاري' : 'Commercial Registration No.'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.commercialRegistrationNumber}
                onChange={e => handleChange('commercialRegistrationNumber', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'رقم السجل الصناعي المعتمد (IDA)' : 'Industrial Registration (IDA)'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.industrialRegistrationNumber}
                onChange={e => handleChange('industrialRegistrationNumber', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'الرقم الضريبي' : 'Tax ID'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.taxIdNumber}
                onChange={e => handleChange('taxIdNumber', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'القطاع الصناعي' : 'Industrial Sector'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.sector}
                onChange={e => handleChange('sector', e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Section 2: Location & Energy Infrastructure */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Zap size={18} style={{ color: 'var(--gov-gold-dark)' }} />
            <span>{isAr ? '2. الموقع الجغرافي والبيانات الطاقية' : '2. Location & Energy Infrastructure'}</span>
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label required">{isAr ? 'المحافظة' : 'Governorate'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.governorate}
                onChange={e => handleChange('governorate', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">{isAr ? 'المنطقة الصناعية / العنوان التفصيلي' : 'Industrial Zone / Address'}</label>
              <input 
                type="text" 
                className="form-control" 
                value={formData.industrialZone}
                onChange={e => handleChange('industrialZone', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">{isAr ? 'مساحة سطح المصنع الإجمالية (متر مربع)' : 'Total Roof Area (Sq. Meters)'}</label>
              <input 
                type="number" 
                className="form-control" 
                value={formData.roofAreaSqMeters || ''}
                onChange={e => handleChange('roofAreaSqMeters', Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{isAr ? 'متوسط الاستهلاك السنوي للكهرباء (ميجاوات ساعة)' : 'Annual Energy Consumption (MWh)'}</label>
              <input 
                type="number" 
                className="form-control" 
                value={formData.annualEnergyConsumptionMWh || ''}
                onChange={e => handleChange('annualEnergyConsumptionMWh', Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{isAr ? 'متوسط الفاتورة الشهرية (بالجنيه المصري)' : 'Monthly Electricity Bill (EGP)'}</label>
              <input 
                type="number" 
                className="form-control" 
                value={formData.monthlyElectricityBillEGP || ''}
                onChange={e => handleChange('monthlyElectricityBillEGP', Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{isAr ? 'عدد العمال والموظفين' : 'Employees Count'}</label>
              <input 
                type="number" 
                className="form-control" 
                value={formData.employeesCount || ''}
                onChange={e => handleChange('employeesCount', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

         {/* Section 3: Extended Data (Shams El Senaa — General Data) */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <MapPin size={18} style={{ color: 'var(--gov-primary-700)' }} />
            <span>{isAr ? '3. بيانات التواصل الإضافية' : '3. Additional Contact Details'}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">{isAr ? 'العنوان التفصيلي للمنشأة' : 'Detailed Facility Address'}</label>
              <input type="text" className="form-control" value={formData.facilityAddressDetailed || ''} onChange={e => handleChange('facilityAddressDetailed', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'رقم هاتف ثانوي (اختياري)' : 'Secondary Phone (optional)'}</label>
              <input type="text" className="form-control" dir="ltr" value={formData.secondaryPhone || ''} onChange={e => handleChange('secondaryPhone', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'الموقع الرسمي (اختياري)' : 'Official Website (optional)'}</label>
              <input type="text" className="form-control" dir="ltr" value={formData.website || ''} onChange={e => handleChange('website', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'المسمى الوظيفي لمسؤول التواصل' : 'Contact Job Title'}</label>
              <input type="text" className="form-control" value={formData.contactJobTitle || ''} onChange={e => handleChange('contactJobTitle', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'فاكس (اختياري)' : 'Fax (optional)'}</label>
              <input type="text" className="form-control" dir="ltr" value={formData.contactFax || ''} onChange={e => handleChange('contactFax', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'موبايل مسؤول التواصل' : 'Contact Mobile'}</label>
              <input type="text" className="form-control" dir="ltr" value={formData.contactMobile || ''} onChange={e => handleChange('contactMobile', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'البريد الإلكتروني لمسؤول التواصل' : 'Contact Email'}</label>
              <input type="email" className="form-control" dir="ltr" value={formData.contactEmail || ''} onChange={e => handleChange('contactEmail', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Factory size={18} style={{ color: 'var(--gov-primary-700)' }} />
            <span>{isAr ? '4. الأنشطة الصناعية والإنتاج' : '4. Industrial Activities and Production'}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{isAr ? 'المنتجات الرئيسية' : 'Main Products'}</label>
              <textarea className="form-control" rows={3} value={formData.mainProducts || ''} onChange={e => handleChange('mainProducts', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{isAr ? 'عمليات التصنيع الرئيسية' : 'Main Manufacturing Processes'}</label>
              <textarea className="form-control" rows={3} value={formData.mainProcesses || ''} onChange={e => handleChange('mainProcesses', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Zap size={18} style={{ color: 'var(--gov-gold-dark)' }} />
            <span>{isAr ? '5. استهلاك الكهرباء السنوي' : '5. Annual Electricity Consumption'}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">{isAr ? 'نوع مصدر الكهرباء' : 'Electricity Source Type'}</label>
              <select className="form-control" value={formData.electricitySourceType || ''} onChange={e => handleChange('electricitySourceType', (e.target.value || null) as 'public' | 'other' | null)}>
                <option value="">{isAr ? 'غير محدد' : 'Unspecified'}</option>
                <option value="public">{isAr ? 'الشبكة العمومية' : 'Public Electricity Supply'}</option>
                <option value="other">{isAr ? 'أخرى' : 'Other'}</option>
              </select>
            </div>
            {formData.electricitySourceType === 'other' && (
              <div className="form-group">
                <label className="form-label required">{isAr ? 'وصف مصدر الكهرباء البديل' : 'Other Source Description'}</label>
                <input type="text" className="form-control" value={formData.electricitySourceOther || ''} onChange={e => handleChange('electricitySourceOther', e.target.value)} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{isAr ? 'الاستهلاك السنوي (kWh)' : 'Annual Consumption (kWh)'}</label>
              <input type="number" min={0} className="form-control" dir="ltr" value={formData.annualElectricityKwh ?? ''} onChange={e => handleChange('annualElectricityKwh', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'ساعات التشغيل / يوم' : 'Operating Hours / Day'}</label>
              <input type="number" min={0} max={24} className="form-control" dir="ltr" value={formData.operatingHoursPerDay ?? ''} onChange={e => handleChange('operatingHoursPerDay', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'أيام التشغيل / أسبوع' : 'Operating Days / Week'}</label>
              <input type="number" min={0} max={7} step={1} className="form-control" dir="ltr" value={formData.operatingDaysPerWeek ?? ''} onChange={e => handleChange('operatingDaysPerWeek', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'تكلفة الكهرباء (جنيه)' : 'Electricity Cost (EGP)'}</label>
              <input type="number" min={0} step="0.01" className="form-control" dir="ltr" value={formData.electricityCostEGP ?? ''} onChange={e => handleChange('electricityCostEGP', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Building2 size={18} style={{ color: 'var(--gov-primary-700)' }} />
            <span>{isAr ? '6. المساحات المتاحة (م²)' : '6. Available Areas (m²)'}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">{isAr ? 'أسطح خرسانية (م²)' : 'Concrete Roof (m²)'}</label>
              <input type="number" min={0} className="form-control" dir="ltr" value={formData.concreteRoofM2 ?? ''} onChange={e => handleChange('concreteRoofM2', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'أسطح معدنية (م²)' : 'Metal Roof (m²)'}</label>
              <input type="number" min={0} className="form-control" dir="ltr" value={formData.metalRoofM2 ?? ''} onChange={e => handleChange('metalRoofM2', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">{isAr ? 'أرض فضاء (م²)' : 'Vacant Land (m²)'}</label>
              <input type="number" min={0} className="form-control" dir="ltr" value={formData.vacantLandM2 ?? ''} onChange={e => handleChange('vacantLandM2', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>
          <div className="form-helper" style={{ fontWeight: 700 }}>
            {formData.totalAvailableM2 !== null && formData.totalAvailableM2 !== undefined
              ? (isAr ? `إجمالي المساحة المتاحة: ${Number(formData.totalAvailableM2).toLocaleString('ar-EG')} م² (يُعاد حسابه تلقائياً عند الحفظ)` : `Total: ${Number(formData.totalAvailableM2).toLocaleString('en')} m² (recomputed on save)`)
              : (isAr ? 'إجمالي المساحة المتاحة: غير مكتمل — أدخل المكونات الثلاثة.' : 'Total available area: incomplete — enter all three components.')}
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ShieldCheck size={18} style={{ color: 'var(--gov-primary-700)' }} />
            <span>{isAr ? '7. ممارسات كفاءة الطاقة' : '7. Energy Efficiency Practices'}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px), 1fr))', gap: '1.5rem' }}>
            {([
              ['hasEnergyReductionProcedures', isAr ? 'إجراءات لخفض استهلاك الطاقة أثناء الإنتاج؟' : 'Procedures to reduce energy use in production?'],
              ['hasEfficiencyStudies', isAr ? 'دراسات لتحسين كفاءة الطاقة؟' : 'Studies to improve energy efficiency?'],
              ['hasEnergyDept', isAr ? 'إدارة متخصصة للطاقة؟' : 'Dedicated Energy Management Department?'],
            ] as const).map(([field, label]) => {
              const v = formData[field];
              return (
                <div className="form-group" key={field}>
                  <label className="form-label">{label}</label>
                  <select
                    className="form-control"
                    value={v === true ? 'yes' : v === false ? 'no' : ''}
                    onChange={e => handleChange(field, e.target.value === '' ? null : e.target.value === 'yes')}
                  >
                    <option value="">{isAr ? 'غير محدد' : 'Unspecified'}</option>
                    <option value="yes">{isAr ? 'نعم' : 'Yes'}</option>
                    <option value="no">{isAr ? 'لا' : 'No'}</option>
                  </select>
                </div>
              );
            })}
            <div className="form-group">
              <label className="form-label">{isAr ? 'ملاحظات إضافية (اختياري)' : 'Additional Notes (optional)'}</label>
              <textarea className="form-control" rows={2} value={formData.energyNotes || ''} onChange={e => handleChange('energyNotes', e.target.value)} />
            </div>
          </div>
        </div>

         {/* Section 4: Factory Details Files — يرفعها المصنع بنفسه */}
        <div style={{ marginBottom: '2rem', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-md)', padding: '1.25rem', background: 'var(--bg-surface)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gov-primary-900)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Upload size={18} style={{ color: 'var(--gov-gold-dark)' }} />
            <span>{isAr ? '4. ملف تفاصيل المصنع PDF (مستندات إضافية: كتالوجات / رسومات / ملف تفصيلي)' : '4. Factory Details PDF File'}</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {isAr ? 'ارفع ملف PDF تفصيلي بنفسك (مستندات إضافية) وسيظهر تلقائيا للمراجعين عند التقديم على أي مبادرة.' : 'Upload your own details PDF (extra docs) — reviewers will see it with your applications.'}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end', marginBottom: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{isAr ? 'وصف الملف' : 'File description'}</label>
              <input type="text" className="form-control" value={detailsDesc} onChange={e => setDetailsDesc(e.target.value)} placeholder={isAr ? 'مثال: كتالوج خط الإنتاج + القدرة المطلوبة' : 'e.g. Line catalog'} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{isAr ? 'اختر الملف' : 'Choose file'}</label>
              <input type="file" className="form-control" accept=".pdf,application/pdf" onChange={e => setPendingFile(e.target.files?.[0] || null)} />
            </div>
            <button type="button" className="btn btn-secondary" disabled={!pendingFile} onClick={handleDetailsUpload}>
              <Upload size={16} />
              <span>{isAr ? 'رفع الملف' : 'Upload'}</span>
            </button>
          </div>
          {pendingFile && (
            <div style={{ fontSize: '0.8rem', color: 'var(--gov-primary-800)', marginBottom: '0.75rem' }}>
              {isAr ? 'الملف الجاهز للرفع:' : 'Ready:'} {pendingFile.name} ({formatSize(pendingFile.size)})
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {detailsFiles.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem' }}>
                {isAr ? 'لا توجد ملفات تفاصيل مرفوعة بعد.' : 'No details files uploaded yet.'}
              </div>
            )}
            {detailsFiles.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <FileText size={18} style={{ color: 'var(--gov-primary-800)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--gov-primary-900)' }}>{f.fileName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.description} • {f.fileSize} • {new Date(f.uploadedAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Badge tone="pending">{isAr ? 'قيد التدقيق' : f.status}</Badge>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void api.deleteDetailsFile(factory.id, f.id).then(() => refreshFiles(factory.id)).catch((err: unknown) => alert(err instanceof Error ? err.message : 'Delete failed.')); }} title={isAr ? 'مسح الملف' : 'Delete'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary btn-lg">
            <Save size={18} />
            <span>{isAr ? 'حفظ وتحديث الملف الموحد' : 'Save Central Profile'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
